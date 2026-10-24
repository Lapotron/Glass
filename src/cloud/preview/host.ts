import { Buffer } from 'buffer';
import {
  renderMarkdown,
  renderMathPreviews,
  renderSourceMathPreviews,
} from '../../engine/markdown.js';
import { renderComponentPreviews } from '../../engine/component-previews.js';
import { createRenderer } from '../../site/pages.js';
import { mathjax } from '../../shared/math-renderer.js';
import { diagramPresentation } from '../../shared/diagram-presentation.js';
import { routeFor, entrySchema } from '../../shared/contracts.js';
import { inspectMarkdown } from '../../shared/markdown-analysis.js';
import { authoringCapabilities } from '../../shared/authoring-capabilities.js';
import { useOriginalMediaImages } from '../../engine/responsive-images.js';
(globalThis as any).Buffer = Buffer;
(globalThis as any).process = {
  env: { NODE_ENV: 'production' },
  platform: 'browser',
  arch: 'browser',
  versions: { node: 'browser' },
  cwd: () => '/preview',
};
const fonts = import.meta.glob('/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js');
mathjax.asyncLoad = (name: string) => {
  const file = name.split('/').at(-1)!.replace(/\.js$/, '') + '.js',
    key = Object.keys(fonts).find((k) => k.endsWith('/' + file));
  if (!key) throw new Error('Math font is unavailable.');
  return fonts[key]();
};
let queue = Promise.resolve();
const cancelled = new Set<number>();
const pending = new Set<number>();
window.addEventListener('message', (event) => {
  if (
    event.source === parent &&
    event.origin === location.origin &&
    event.data?.type === 'glass-cloud-cancel'
  ) {
    if (pending.has(event.data.id)) cancelled.add(event.data.id);
    return;
  }
  if (
    event.source !== parent ||
    event.origin !== location.origin ||
    event.data?.type !== 'glass-cloud-render'
  )
    return;
  const { id, route, input, model, assets } = event.data;
  pending.add(id);
  queue = queue.then(async () => {
    if (cancelled.delete(id)) {
      pending.delete(id);
      return;
    }
    try {
      let result: unknown;
      if (route === 'authoring/math-preview')
        result = {
          results:
            typeof input.source === 'string'
              ? await renderSourceMathPreviews(input.source, input.ranges, input.math)
              : await renderMathPreviews(input.expressions, input.math),
        };
      else if (route === 'authoring/component-preview')
        result = {
          results: await renderComponentPreviews(
            input.source,
            input.blocks,
            '/preview',
            undefined,
            input.math,
            diagramPresentation(model.site.theme),
          ),
        };
      else if (route === 'authoring/validate') {
        const analysis = inspectMarkdown(input.source);
        if (input.full) await renderMarkdown(input.source);
        result = { ...analysis, ok: !analysis.diagnostics.some((d) => d.severity === 'error') };
      } else if (route === 'authoring/capabilities') result = authoringCapabilities();
      else if (route === 'preview') {
        if (input.site) model.site = input.site;
        if (input.projects) model.projects = input.projects;
        if (input.route === '/about/' && input.body !== undefined) model.about.body = input.body;
        let entry = model.entries.find((e: any) => e.id === input.entryId);
        if (input.draft) {
          const metadata = entrySchema.parse({ ...input.draft.metadata, status: 'draft' });
          entry = {
            ...metadata,
            body: input.draft.body,
            kind: input.draft.kind,
            file: 'preview.md',
            revision: 'preview',
          };
          model.entries.push(entry);
        }
        if (entry) {
          if (input.metadata)
            for (const key of Object.keys(entrySchema.shape)) entry[key] = input.metadata[key];
          if (input.body !== undefined) entry.body = input.body;
        }
        model.entries = model.entries.filter(
          (e: any) => e.status === 'published' || e.id === entry?.id,
        );
        const renderer = await createRenderer(model, {
          includeDrafts: !!entry || !!input.projects,
          preview: true,
          readerAssets: assets,
        });
        result = {
          html: useOriginalMediaImages(
            renderer.render(entry ? routeFor(entry, model.site.collections) : input.route || '/'),
          ),
        };
      } else throw new Error('Unknown preview operation.');
      if (!cancelled.delete(id))
        parent.postMessage({ type: 'glass-cloud-rendered', id, result }, location.origin);
    } catch (error) {
      if (cancelled.delete(id)) return;
      parent.postMessage(
        { type: 'glass-cloud-rendered', id, error: (error as Error).message },
        location.origin,
      );
    } finally {
      pending.delete(id);
      cancelled.delete(id);
    }
  });
});
parent.postMessage({ type: 'glass-cloud-render-ready' }, location.origin);
