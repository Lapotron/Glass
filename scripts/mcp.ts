import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { authoringInstructions } from '../src/shared/authoring-instructions.js';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { entrySchema, routeFor } from '../src/shared/contracts.js';
import type { Bootstrap } from '../src/console/api.js';

const arg = (name: string) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const root = await fs.realpath(path.resolve(arg('root') || process.cwd()));
const port = Number(arg('port') || 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Use a valid local Studio port.');
const origin = 'http://127.0.0.1:' + port;
const workspace = createHash('sha256').update(root).digest('hex');
let token = '';
async function connect() {
  const response = await fetch(origin + '/api/bootstrap', {
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Open Studio for this notebook before connecting MCP.');
  const data = (await response.json()) as Bootstrap;
  if (data.workspaceId !== workspace)
    throw new Error(
      'Studio is serving a different notebook. Open the selected notebook and reconnect.',
    );
  token = data.token;
  return data;
}
async function request(route: string, input?: unknown) {
  await connect();
  const response = await fetch(origin + '/api/' + route, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Studio-Token': token },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
const server = new McpServer({ name: 'glass-authoring', version: '1.0.0' });
const content = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const resource = (uri: URL, data: unknown) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
});
server.registerResource(
  'capabilities',
  'glass://authoring/capabilities',
  { description: 'Versioned executable Markdown capabilities and schemas.' },
  async (uri) => resource(uri, await request('authoring/capabilities')),
);
server.registerResource(
  'reference',
  'glass://authoring/reference',
  { description: 'Maintained Glass Markdown syntax.' },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: 'text/markdown',
        text: await fs.readFile(new URL('../docs/markdown-reference.md', import.meta.url), 'utf8'),
      },
    ],
  }),
);
server.registerResource(
  'authoring-skill',
  'glass://authoring/skill',
  { description: 'Portable Glass Markdown composition and conversion instructions.' },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: 'text/markdown',
        text: authoringInstructions('mcp'),
      },
    ],
  }),
);
const guides = ['math-authoring', 'pseudocode', 'latex-conversion', 'markdown-ide', 'diagrams'];
server.registerResource(
  'guides',
  new ResourceTemplate('glass://authoring/guides/{name}', {
    list: async () => ({
      resources: guides.map((name) => ({ uri: 'glass://authoring/guides/' + name, name })),
    }),
  }),
  { description: 'Math, pseudocode, diagram and conversion guides.' },
  async (uri, variables) => {
    const name = String(variables.name);
    if (!guides.includes(name)) throw new Error('Unknown authoring guide.');
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: await fs.readFile(new URL('../docs/' + name + '.md', import.meta.url), 'utf8'),
        },
      ],
    };
  },
);
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
server.registerResource(
  'templates',
  new ResourceTemplate('glass://authoring/templates/{name}', {
    list: async () => ({
      resources: templates.map((name) => ({
        uri: 'glass://authoring/templates/' + name,
        name,
        mimeType: 'text/markdown',
      })),
    }),
  }),
  { description: 'Reviewed Markdown templates.' },
  async (uri, variables) => {
    const name = String(variables.name);
    if (!templates.includes(name)) throw new Error('Unknown template.');
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: await fs.readFile(
            new URL('../docs/authoring-templates/' + name + '.md', import.meta.url),
            'utf8',
          ),
        },
      ],
    };
  },
);
server.registerResource(
  'links',
  'glass://workspace/links',
  { description: 'Scoped notebook links; draft destinations require publication.' },
  async (uri) => {
    const data = await connect();
    return resource(
      uri,
      data.entries.map((e) => ({
        id: e.id,
        title: e.title,
        kind: e.kind,
        status: e.status,
        revision: e.revision,
        url: routeFor(e, data.site.collections),
      })),
    );
  },
);
server.registerResource(
  'media',
  'glass://workspace/media',
  { description: 'Canonical local media and safe metadata; private originals excluded.' },
  async (uri) => resource(uri, await request('media')),
);
server.registerTool(
  'list_templates',
  {
    description: 'List supported Glass authoring templates.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => content({ version: 'fieldnotes-markdown/1', templates }),
);
server.registerTool(
  'validate_markdown',
  {
    description: 'Validate Markdown without changing source.',
    inputSchema: { source: z.string().max(1000000), full: z.boolean().default(false) },
    annotations: { readOnlyHint: true },
  },
  async (args) => content(await request('authoring/validate', args)),
);
server.registerTool(
  'render_preview',
  {
    description: 'Render a temporary private noindex preview; does not save or publish.',
    inputSchema: {
      kind: z.enum(['posts', 'lab']),
      title: z.string().min(1).max(160),
      body: z.string().max(1000000),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const id = randomUUID();
    const result = await request('preview', {
      draft: {
        kind: args.kind,
        metadata: entrySchema.parse({
          id,
          title: args.title,
          slug: 'mcp-preview-' + id,
          publishedAt: new Date().toISOString().slice(0, 10),
          status: 'draft',
        }),
        body: args.body,
      },
    });
    return content({ ...result, url: new URL(result.url, origin).href });
  },
);
server.registerTool(
  'prepare_draft',
  {
    description:
      'Create or revise a validated ordinary draft. Existing drafts require their expected revision; published entries are read-only. No publication.',
    inputSchema: {
      kind: z.enum(['posts', 'lab']),
      title: z.string().min(1).max(160),
      slug: z.string(),
      body: z.string().max(1000000),
      metadata: z.record(z.string(), z.unknown()).optional(),
      targetId: z.string().optional(),
      revision: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async (args) => content(await request('authoring/draft', args)),
);
await connect();
await server.connect(new StdioServerTransport());
