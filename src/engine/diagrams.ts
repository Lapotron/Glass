import { chromium, type Browser } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, digest } from './store.js';
import {
  defaultDiagramPresentation,
  type DiagramPresentation,
} from '../shared/diagram-presentation.js';

type Variants = { light: string; dark: string; title?: string };
type CacheEntry = Variants & { key: string; checksum: string };
const memory = new Map<string, CacheEntry>();
const bundle = fileURLToPath(import.meta.resolve('mermaid/dist/mermaid.min.js'));
const browserScript = fileURLToPath(new URL('./diagram-browser.js', import.meta.url));
let bundleHash: Promise<string> | undefined;
let browser: Promise<Browser> | undefined;
let queue = Promise.resolve();
let owners = 0;
// Increment when the sanitizer, font or rendering contract changes.
const rendererVersion = 'static-mermaid-glass-2';

export function createDiagramRenderer(
  options: {
    cacheDir?: string;
    launch?: () => Promise<Browser>;
    timeout?: number;
  } = {},
) {
  owners++;
  let closed = false;
  const render = async (
    source: string,
    namespace: string,
    presentation: DiagramPresentation = defaultDiagramPresentation,
  ): Promise<Variants> => {
    if (closed) throw new Error('The diagram rendering session is closed.');
    if (source.length > 50000)
      throw new Error('Mermaid diagrams must be smaller than 50,000 characters.');
    const engine = await (bundleHash ??= Promise.all([
      fs.readFile(bundle),
      fs.readFile(browserScript),
    ]).then((files) => digest(Buffer.concat(files))));
    const key = digest(
      JSON.stringify([rendererVersion, engine, process.platform, source, presentation]),
    );
    const prefix = `diagram-${key}-`;
    const file = options.cacheDir && path.join(options.cacheDir, key + '.json');
    const work = async () => {
      let cached = memory.get(key);
      if (!cached && file) {
        try {
          const record = JSON.parse(await fs.readFile(file, 'utf8')) as CacheEntry;
          if (
            record.key === key &&
            record.checksum === digest(record.light + record.dark + (record.title || '')) &&
            record.light.startsWith('<svg') &&
            record.dark.startsWith('<svg')
          )
            cached = record;
        } catch {
          /* An incomplete cache is regenerated from canonical source. */
        }
      }
      if (!cached) {
        let instance: Browser;
        try {
          instance = options.launch
            ? await options.launch()
            : await (browser ??= (async () => {
                if (process.env.GLASS_CI_CHROMIUM === 'true' && process.platform === 'linux') {
                  const { default: binary } = await import('@sparticuz/chromium');
                  return chromium.launch({
                    headless: true,
                    timeout: 15000,
                    // Workers Builds has a normal Linux process sandbox. Lambda's
                    // single-process mode cannot survive closing a browser context
                    // between two diagram renders.
                    args: binary.args.filter((argument) => argument !== '--single-process'),
                    executablePath: await binary.executablePath(),
                  });
                }
                return chromium.launch({ headless: true, timeout: 15000 });
              })());
        } catch {
          browser = undefined;
          throw new Error(
            'Mermaid SVG rendering needs local Chromium. Run npm run renderers:install, then build again.',
          );
        }
        const page = await instance.newPage({ viewport: { width: 1280, height: 900 } });
        const remote: string[] = [];
        await page.route('**/*', (request) => {
          remote.push(request.request().url());
          return request.abort();
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const rendering = (async () => {
            await page.setContent('<!doctype html><html><body></body></html>');
            await page.addScriptTag({ path: bundle });
            await page.addScriptTag({ path: browserScript });
            return page.evaluate(
              ({ source, prefix, presentation }) =>
                (globalThis as any).renderBlogDiagram({
                  source,
                  prefix,
                  presentation,
                }) as Promise<Variants>,
              { source, prefix, presentation },
            );
          })();
          const result = await Promise.race([
            rendering,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      'Diagram rendering exceeded 15 seconds. Simplify this diagram and try again.',
                    ),
                  ),
                options.timeout || 15000,
              );
            }),
          ]);
          if (remote.length)
            throw new Error(
              'Diagrams cannot load external resources. Use self-contained Mermaid source.',
            );
          cached = {
            ...result,
            key,
            checksum: digest(result.light + result.dark + (result.title || '')),
          };
          if (file) await atomicWrite(file, JSON.stringify(cached));
        } finally {
          clearTimeout(timer);
          await page.close();
          if (options.launch) await instance.close();
        }
      }
      if (memory.size >= 128) memory.delete(memory.keys().next().value!);
      memory.set(key, cached);
      const safeNamespace = namespace.replace(/[^\w-]/g, '-');
      return {
        light: cached.light.replaceAll(prefix, `${safeNamespace}-`),
        dark: cached.dark.replaceAll(prefix, `${safeNamespace}-`),
        title: cached.title,
      };
    };
    const pending = queue.then(work);
    queue = pending.then(
      () => {},
      () => {},
    );
    return pending;
  };
  return {
    render,
    async close() {
      if (closed) return;
      closed = true;
      owners--;
      // A plain Markdown request must not wait for another session's diagram work.
      if (owners) return;
      await queue;
      if (!owners && browser) {
        const closing = browser;
        browser = undefined;
        await (await closing).close();
      }
    },
  };
}
export type DiagramRenderer = ReturnType<typeof createDiagramRenderer>;
