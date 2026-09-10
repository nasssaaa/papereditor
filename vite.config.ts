import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
// PDF.js needs bundled CMaps for CJK glyphs and text extraction.
const pdfAssets = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'pdf-resources',
      configureServer(server) {
        server.middlewares.use('/pdfjs', (req, res, next) => {
          const relative = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\//, '');
          if (!/^(cmaps|standard_fonts|wasm|iccs)\/[a-zA-Z0-9_.-]+$/.test(relative)) return next();
          const file = path.resolve('node_modules/pdfjs-dist', relative);
          if (!fs.existsSync(file)) return next();
          res.setHeader(
            'Content-Type',
            file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
          );
          fs.createReadStream(file).pipe(res);
        });
      },
      closeBundle() {
        for (const name of pdfAssets)
          fs.cpSync(`node_modules/pdfjs-dist/${name}`, `dist/client/pdfjs/${name}`, {
            recursive: true,
          });
        fs.copyFileSync('node_modules/pdfjs-dist/LICENSE', 'dist/client/pdfjs/LICENSE');
      },
    },
  ],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:18080',
      '/collab': { target: 'ws://127.0.0.1:18080', ws: true },
      '/events': { target: 'ws://127.0.0.1:18080', ws: true },
    },
  },
});
