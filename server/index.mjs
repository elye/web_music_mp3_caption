import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { createLocalTranscriber } from './local-transcriber.mjs';

const transcriber = createLocalTranscriber();
const app = createApp({ transcriber });
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (existsSync(dist)) {
  // Production pages can load/connect only to this local origin, not remote services.
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
}
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', async () => {
  console.log(`Chorus localhost${existsSync(dist) ? ' + app' : ''}: http://127.0.0.1:${port}`);
  const status = await transcriber.status();
  console.log(`Local transcription: ${status.message}`);
  console.log('Audio processing stays on this computer. No cloud fallback or API key.');
});
