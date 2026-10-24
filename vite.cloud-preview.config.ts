import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const file = (name: string) =>
  fileURLToPath(new URL('./src/cloud/preview/' + name, import.meta.url));
export default defineConfig({
  base: '/cloud-compiler/',
  resolve: {
    alias: {
      'node:path': file('compat.ts'),
      'node:url': file('compat.ts'),
      'node:fs': file('compat.ts'),
      'node:crypto': file('compat.ts'),
      'decode-named-character-reference': fileURLToPath(
        new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url),
      ),
    },
  },
  plugins: [
    {
      name: 'private-browser-compiler',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer) return;
        const names: Record<string, string> = {
          '/store.js': 'compat.ts',
          '/work-cache.js': 'cache.ts',
          '/markdown-cache.js': 'markdown-cache.ts',
          '/diagrams.js': 'diagrams.ts',
          '/integrations.js': 'integrations.ts',
        };
        for (const [suffix, target] of Object.entries(names))
          if (source.endsWith(suffix) && !importer.includes('/cloud/preview/')) return file(target);
      },
    },
  ],
  build: {
    outDir: '.studio/cloud/studio/assets/cloud-compiler',
    emptyOutDir: true,
    lib: { entry: 'src/cloud/preview/bootstrap.ts', formats: ['es'], fileName: 'compiler' },
    rolldownOptions: { output: { inlineDynamicImports: false } },
  },
});
