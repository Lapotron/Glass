import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { z } from 'zod';
import type { Store } from '../engine/store.js';
import { inspectMarkdown } from '../shared/markdown-analysis.js';
import { authoringCapabilities } from '../shared/authoring-capabilities.js';
import { authoringInstructions } from '../shared/authoring-instructions.js';
import { publicEntry, routeFor, entrySchema } from '../shared/contracts.js';
import type { Actor, CloudEnv } from './types.js';
import type { CloudWorkspace } from './workspace.js';
import { cloudMedia } from './media.js';
import { enqueue, type CloudJob } from './jobs.js';
const guides = [
  'markdown-reference',
  'authoring',
  'diagrams',
  'math-authoring',
  'pseudocode',
  'latex-conversion',
  'markdown-ide',
];
const templates = [
  'research-note',
  'tutorial',
  'visual-explainer',
  'chart-examples',
  'stem-algorithms',
  'code-projects',
  'pseudocode-sort',
  'mermaid-diagrams',
];
export async function serveMcp(
  request: Request,
  env: CloudEnv,
  store: Store,
  workspace: CloudWorkspace,
  actor: Actor,
) {
  const server = new McpServer(
    { name: 'glass-cloud-authoring', version: '1.0.0' },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  const result = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });
  const resource = (uri: URL, value: unknown) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value) }],
  });
  async function textResource(uri: URL, path: string) {
    const response = await env.ASSETS.fetch(
      new Request(new URL('/authoring/' + path, env.STUDIO_ORIGIN)),
    );
    if (!response.ok) throw new Error('Authoring reference is unavailable.');
    return {
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await response.text() }],
    };
  }
  async function queued(path: string, body: unknown) {
    const job = await enqueue(
      new Request(env.STUDIO_ORIGIN + '/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      workspace,
      actor,
    );
    return result({
      jobId: job.id,
      state: job.state,
      next: 'Call job_status until complete. Heavy rendering runs in the private build queue.',
    });
  }
  server.registerResource('capabilities', 'glass://authoring/capabilities', {}, async (uri) =>
    resource(uri, authoringCapabilities()),
  );
  server.registerResource('reference', 'glass://authoring/reference', {}, (uri) =>
    textResource(uri, 'markdown-reference.md'),
  );
  server.registerResource('authoring-skill', 'glass://authoring/skill', {}, (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: authoringInstructions('mcp') }],
  }));
  server.registerResource('entries', 'glass://workspace/entries', {}, async (uri) =>
    resource(
      uri,
      (await store.snapshot()).entries.map(({ id, title, kind, status, revision }) => ({
        id,
        title,
        kind,
        status,
        revision,
      })),
    ),
  );
  server.registerResource('links', 'glass://workspace/links', {}, async (uri) => {
    const model = await store.snapshot();
    return resource(
      uri,
      model.entries.map(({ id, title, kind, status, revision, slug }) => ({
        id,
        title,
        kind,
        status,
        revision,
        url: routeFor({ kind, slug }, model.site.collections),
      })),
    );
  });
  server.registerResource('media', 'glass://workspace/media', {}, async (uri) =>
    resource(uri, await cloudMedia(workspace, store)),
  );
  for (const [kind, names, folder] of [
    ['guides', guides, ''],
    ['templates', templates, 'templates/'],
  ] as const) {
    server.registerResource(
      kind,
      new ResourceTemplate('glass://authoring/' + kind + '/{name}', {
        list: async () => ({
          resources: names.map((name) => ({
            name,
            uri: 'glass://authoring/' + kind + '/' + name,
            mimeType: 'text/markdown',
          })),
        }),
      }),
      {},
      async (uri, variables) => {
        const name = String(variables.name);
        if (!names.includes(name)) throw new Error('Unknown authoring reference.');
        return textResource(uri, folder + name + '.md');
      },
    );
  }
  server.registerTool(
    'list_templates',
    { inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => result({ version: 'fieldnotes-markdown/1', templates }),
  );
  server.registerTool(
    'validate_markdown',
    {
      inputSchema: { source: z.string().max(1_000_000), full: z.boolean().default(false) },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      input.full ? queued('authoring/validate', input) : result(inspectMarkdown(input.source)),
  );
  server.registerTool(
    'render_preview',
    {
      description:
        'Create a private noindex preview in the build queue, without saving or publishing.',
      inputSchema: {
        kind: z.enum(['posts', 'lab']),
        title: z.string().min(1).max(160),
        body: z.string().max(1_000_000),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const id = crypto.randomUUID();
      return queued('preview', {
        draft: {
          kind: input.kind,
          metadata: entrySchema.parse({
            id,
            title: input.title,
            slug: 'mcp-preview-' + id,
            publishedAt: new Date().toISOString().slice(0, 10),
            status: 'draft',
          }),
          body: input.body,
        },
      });
    },
  );
  server.registerTool(
    'job_status',
    {
      description: 'Read only this authoring client owner’s validation or preview result.',
      inputSchema: { id: z.uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const job = await env.DB.prepare('SELECT * FROM cloud_jobs WHERE id=? AND actor=?')
        .bind(id, actor.id)
        .first<CloudJob>();
      if (!job || !/^\/api\/(?:authoring\/validate|preview)$/.test(JSON.parse(job.request).path))
        throw new Error('This is not an available authoring job.');
      const object = job.result_key
        ? await env.BUCKET.get('jobs/' + id + '/objects/' + job.result_key)
        : null;
      const value = object ? JSON.parse(await object.text()).body : undefined;
      if (value?.url) value.url = new URL(value.url, env.STUDIO_ORIGIN).href;
      return result({ id, state: job.state, error: job.error || undefined, result: value });
    },
  );
  server.registerTool(
    'prepare_draft',
    {
      description:
        'Create or update a private draft. Published entries are read-only; no publishing or arbitrary file operations.',
      inputSchema: {
        kind: z.enum(['posts', 'lab']),
        title: z.string().min(1).max(160),
        slug: z.string(),
        body: z.string().max(1_000_000),
        metadata: z.record(z.string(), z.unknown()).optional(),
        targetId: z.string().optional(),
        id: z.string().optional(),
        revision: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const analysis = inspectMarkdown(input.body);
      if (analysis.diagnostics.some((d) => d.severity === 'error'))
        return { ...result(analysis), isError: true };
      const id = input.targetId || input.id;
      if (id) {
        const entry = (await store.snapshot()).entries.find((e) => e.id === id);
        if (!entry || entry.status !== 'draft')
          throw new Error('Only existing ordinary drafts may be changed.');
        if (entry.kind !== input.kind)
          throw new Error('Convert collections in Studio before revising this draft.');
        if (!input.revision) throw new Error('The current revision is required.');
        return result(
          publicEntry(
            await store.saveEntry(entry.id, {
              metadata: {
                ...entry,
                ...input.metadata,
                id: entry.id,
                status: 'draft',
                title: input.title,
                slug: input.slug,
              },
              body: input.body,
              revision: input.revision,
            }),
          ),
        );
      }
      return result(
        publicEntry(
          await store.create(input.kind, input.title, input.slug, {
            body: input.body,
            metadata: input.metadata,
          }),
        ),
      );
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
