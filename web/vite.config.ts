import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * Serve ../data/tiles at /tiles in `vite dev` and `vite preview` without copying it into
 * dist/ (real tile sets are GBs). Missing files get a real 404 instead of the SPA fallback,
 * which the viewer relies on to detect layers that are not built yet.
 */
function tiles(): Plugin {
  const root = resolve(import.meta.dirname, '../data/tiles');
  const types: Record<string, string> = { json: 'application/json', bin: 'application/octet-stream' };
  const handler = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const url = (req.url ?? '').split('?')[0];
    if (!url.startsWith('/tiles/')) return next();
    if (url === '/tiles/_index.json') {
      // what is actually built, so the viewer does not probe (and log 404s for) missing layers
      const dirs = existsSync(root) ? readdirSync(root, { withFileTypes: true }) : [];
      // symlinked layer directories count too (worktrees link the big tile sets)
      const layers = dirs.filter((d) => (d.isDirectory() || d.isSymbolicLink()) && existsSync(resolve(root, d.name, 'meta.json'))).map((d) => d.name);
      const catDir = resolve(root, 'catalogs');
      const catalogs = existsSync(catDir) ? readdirSync(catDir).filter((f) => f.endsWith('.json')) : [];
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      return res.end(JSON.stringify({ layers, catalogs }));
    }
    const file = resolve(root, decodeURIComponent(url.slice('/tiles/'.length)));
    if (file !== root && !file.startsWith(root + sep)) {
      res.statusCode = 403;
      return res.end();
    }
    let size = 0;
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error('not a file');
      size = st.size;
    } catch {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('not found');
    }
    res.setHeader('Content-Type', types[file.split('.').pop() ?? ''] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'cosmic-atlas-tiles',
    configureServer(s) {
      s.middlewares.use(handler);
    },
    configurePreviewServer(s) {
      s.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [tiles()],
  // three/webgpu (WebGPU + WebGL2 backends + TSL) is ~0.9 MB minified on its own
  build: { target: 'es2022', chunkSizeWarningLimit: 1100 },
  server: { port: 5173, strictPort: false },
});
