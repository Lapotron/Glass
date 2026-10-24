import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** One production bundler shared by deployment and runtime tests. No runtime filesystem or eval. */
export async function bundleCloudWorker(outfile: string, testSource?: string) {
  return build({
    ...(testSource
      ? { stdin: { contents: testSource, resolveDir: process.cwd() } }
      : { entryPoints: ['src/cloud/worker.ts'] }),
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    minify: true,
    packages: 'bundle',
    external: ['node:*'],
    alias: {
      'node:fs': path.resolve('src/cloud/filesystem.ts'),
      yaml: path.resolve('node_modules/yaml/browser/index.js'),
      'react-dom/server': 'react-dom/server.browser',
    },
    define: { 'import.meta.dirname': JSON.stringify('/app') },
    plugins: [
      {
        name: 'embed-shared-discussion-css',
        setup(builder) {
          builder.onLoad({ filter: /[/\\]engine[/\\]integrations\.ts$/ }, async (args) => {
            const source = await fs.readFile(args.path, 'utf8'),
              css = await fs.readFile('src/site/giscus-theme.css', 'utf8');
            const contents = source
              .replace("import { readFileSync } from 'node:fs';", '')
              .replace(
                "const discussionStyles = readFileSync(new URL('../site/giscus-theme.css', import.meta.url), 'utf8');",
                'const discussionStyles = ' + JSON.stringify(css) + ';',
              );
            if (contents === source)
              throw new Error('The shared Giscus stylesheet could not be embedded.');
            return { contents, loader: 'ts', resolveDir: path.dirname(args.path) };
          });
        },
      },
    ],
  });
}
