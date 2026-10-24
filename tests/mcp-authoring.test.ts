import { it, expect } from 'vitest';
import { serve } from '@hono/node-server';
import {once} from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../src/server/app.js';
import { SearchConsoleService } from '../src/server/search-console.js';
it('runs a real stdio resource → template → validate → preview → draft workflow without publication', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-mcp-authoring-'));
  await fs.cp('tests/fixtures/notebook', path.join(root, 'content'), { recursive: true });
  const context = await createApp(root, { watchFiles: false });
  const server = serve({ fetch: context.app.fetch, hostname: '127.0.0.1', port: 0 });
  if(!server.listening)await once(server,'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port.');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' &&
        ![
          'CLOUDFLARE_API_TOKEN',
          'ACA_REPORT_TOKEN',
          'R2_ACCESS_KEY_ID',
          'R2_SECRET_ACCESS_KEY',
        ].includes(entry[0]),
    ),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import',
      path.resolve('node_modules/tsx/dist/loader.mjs'),
      path.resolve('scripts/mcp.ts'),
      '--root',
      root,
      '--port',
      String(address.port),
    ],
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'glass-test', version: '1' });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('prepare_draft');
    expect(
      JSON.stringify(await client.readResource({ uri: 'glass://authoring/templates/tutorial' })),
    ).toContain('text/markdown');
    expect(JSON.stringify(await client.readResource({ uri: 'glass://authoring/templates/pseudocode-sort' }))).toContain('FUNCTION PARTITION');
    expect(JSON.stringify(await client.readResource({uri:'glass://authoring/guides/diagrams'}))).toContain('transparent');
    expect(JSON.stringify(await client.readResource({uri:'glass://authoring/templates/mermaid-diagrams'}))).toContain('treeView-beta');
    const validated = await client.callTool({
      name: 'validate_markdown',
      arguments: { source: '## An ordinary section\n\nA paragraph.', full: false },
    });
    expect(validated.isError).not.toBe(true);
    const preview = await client.callTool({
      name: 'render_preview',
      arguments: { kind: 'posts', title: 'Private preview', body: '## A preview\n\nA paragraph.' },
    });
    expect(preview.isError).not.toBe(true);
    expect(JSON.stringify(preview)).toContain('/preview/');
    const result = await client.callTool({
      name: 'prepare_draft',
      arguments: {
        kind: 'posts',
        title: 'Prepared by MCP',
        slug: 'prepared-by-mcp',
        body: '## A section\n\nA paragraph.',
      },
    });
    expect(result.isError).not.toBe(true);
    const saved = (await context.store.read()).entries.find((e) => e.slug === 'prepared-by-mcp')!;
    expect(saved.status).toBe('draft');
    const stale = await client.callTool({
      name: 'prepare_draft',
      arguments: {
        kind: 'posts',
        targetId: saved.id,
        revision: 'bad',
        title: saved.title,
        slug: saved.slug,
        body: 'Unreviewed change',
      },
    });
    expect(stale.isError).toBe(true);
    expect((await context.store.read()).entries.find((e) => e.id === saved.id)?.body).toContain(
      'A paragraph.',
    );
    const published = (await context.store.read()).entries.find((e) => e.status === 'published')!;
    const denied = await client.callTool({
      name: 'prepare_draft',
      arguments: {
        kind: published.kind,
        targetId: published.id,
        revision: published.revision,
        title: published.title,
        slug: published.slug,
        body: 'Cannot change published source',
      },
    });
    expect(denied.isError).toBe(true);
    expect((await context.store.read()).entries.find((e) => e.id === published.id)?.status).toBe(
      'published',
    );
    expect(context.jobs.jobs).toHaveLength(0);
  } finally {
    await client.close();
    await transport.close();
    context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60000);
it('reviews private Search Console replacements and rejects a stale import', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-search-import-'));
  try {
    const service = new SearchConsoleService(root),
      data = {
        source: 'Top pages,Clicks,Impressions,Position\na,2,10,4',
        name: 'Pages.csv',
        property: 'https://example.org',
        from: '2026-10-01',
        to: '2026-10-20',
      };
    const first = await service.prepare(data);
    expect(first.replaces).toBe(false);
    const saved = await service.commit(first.id);
    expect(saved.timezone).toBe('America/Los_Angeles');
    expect(saved.partial).toBe(true);
    const second = await service.prepare({ ...data, source: data.source.replace('2,10', '3,20') }),
      third = await service.prepare({ ...data, source: data.source.replace('2,10', '4,30') });
    expect(second.replaces).toBe(true);
    await service.commit(third.id);
    await expect(service.commit(second.id)).rejects.toThrow('changed');
    expect(await service.list()).toHaveLength(1);
    expect(
      (await fs.stat(path.join(root, '.studio/search-console', saved.id + '.json'))).mode & 0o777,
    ).toBe(0o600);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
