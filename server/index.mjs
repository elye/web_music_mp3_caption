import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const app = createApp();
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(`${dist}/index.html`));
}
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => {
  console.log(`Chorus API${existsSync(dist) ? ' + app' : ''}: http://127.0.0.1:${port}`);
  console.log(`Automatic transcription: ${process.env.OPENAI_API_KEY ? 'configured' : 'off (import LRC/SRT lyrics, or add OPENAI_API_KEY)'}`);
});
