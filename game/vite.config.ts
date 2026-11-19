import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = `${here}../dist`;
const captureDir = `${here}../capture`;

// public/assets-test holds synthetic stand-ins for pipeline tests (?assets=assets-test); never ship it
const dropTestAssets = (): Plugin => ({
  name: 'drop-test-assets',
  apply: 'build',
  closeBundle() {
    rmSync(`${outDir}/assets-test`, { recursive: true, force: true });
  },
});

// Dev only: the capture tool (src/dev/Capture.ts) POSTs finished videos and stills here and they
// are written to capture/. Loopback clients only; file names are sanitised.
const captureSink = (): Plugin => ({
  name: 'capture-sink',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__capture', (req, res) => {
      const ip = req.socket.remoteAddress ?? '';
      if (req.method !== 'POST' || !/^(::1|127\.|::ffff:127\.)/.test(ip)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      const name = (new URL(req.url ?? '', 'http://local').searchParams.get('name') ?? '').replace(/[^a-z0-9._-]/gi, '');
      if (!name || name.startsWith('.')) {
        res.statusCode = 400;
        res.end('bad name');
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        mkdirSync(captureDir, { recursive: true });
        writeFileSync(`${captureDir}/${name}`, body);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, name, bytes: body.length }));
      });
    });
  },
});

export default defineConfig({
  root: here,
  publicDir: `${here}public`,
  base: './',
  plugins: [dropTestAssets(), captureSink()],
  build: {
    outDir,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173, host: true },
});
