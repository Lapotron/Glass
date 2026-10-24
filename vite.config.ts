import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { studioBuildInfo } from './scripts/studio-build-info.js';
export default defineConfig(({ command }) => ({
  define: {
    __GLASS_STUDIO_BUILD__: JSON.stringify(
      studioBuildInfo(fileURLToPath(new URL('.', import.meta.url)), command === 'serve'),
    ),
  },
  plugins: [react()],
  root: 'src/console',
  base: '/studio/',
  resolve: {
    alias: {
      // Remark's browser entity decoder uses document.createElement. Its pure
      // default/worker export also supports Studio's analysis worker and fallback.
      'decode-named-character-reference': fileURLToPath(
        new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url),
      ),
    },
  },
  // The parser/editor is lazy loaded from loopback; keep its cyclic dependency graph together.
  build: { outDir: '../../.studio/console', emptyOutDir: true, chunkSizeWarningLimit: 700 },
  server: { host: '127.0.0.1', ws: { port: 24679 } },
}));
