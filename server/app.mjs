import express from 'express';
import multer from 'multer';
import { createLocalTranscriber } from './local-transcriber.mjs';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 24 * 1024 * 1024, files: 1, fields: 1 } });
const songUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 0 } });
const isAudio = (file) => file && file.size > 0 && /^(audio\/|video\/webm$|application\/octet-stream$)/.test(file.mimetype);
const pcmWav = (file) => file && /^audio\/(wav|x-wav|wave)$/.test(file.mimetype)
  && file.buffer.length >= 44 && file.buffer.toString('ascii', 0, 4) === 'RIFF'
  && file.buffer.toString('ascii', 8, 12) === 'WAVE';

export function createApp({ transcriber = createLocalTranscriber(), port = Number(process.env.PORT || 3001) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  let busy = false;
  // Localhost only. A page on an unrelated website must not consume local CPU or read captions.
  const allowedOrigins = new Set([5173, port].flatMap((value) => [`http://localhost:${value}`, `http://127.0.0.1:${value}`]));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.get('origin') && !allowedOrigins.has(req.get('origin'))) {
      return res.status(403).json({ error: 'Only the local Chorus app can use this helper.' });
    }
    next();
  });
  app.get('/api/status', async (_req, res) => res.json({
    ...await transcriber.status(),
    ...(await transcriber.minusOneStatus?.() ?? { minusOneAvailable: false }),
    busy,
  }));
  app.post('/api/transcribe', async (req, res) => {
    if (!(await transcriber.status()).transcriptionAvailable) {
      return res.status(503).json({ error: 'Local transcription is not ready. Run pnpm setup:local once. No cloud service is used.' });
    }
    if (busy) return res.status(429).json({ error: 'This computer is already transcribing a song. Wait for it to finish or stop it first.' });
    busy = true;
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', onClose);
    try {
      await new Promise((resolve, reject) => upload.single('audio')(req, res, (error) => error ? reject(error) : resolve()));
      if (!pcmWav(req.file)) return res.status(400).json({ error: 'Provide a valid WAV audio chunk prepared by the local app.' });
      controller.signal.throwIfAborted();
      const language = typeof req.body.language === 'string' && /^[a-z]{2}$/.test(req.body.language) ? req.body.language : '';
      const result = await transcriber.transcribe({ buffer: req.file.buffer, language, signal: controller.signal });
      if (controller.signal.aborted) return;
      const lyrics = (result.lyrics ?? []).filter((line) =>
        typeof line.text === 'string' && Number.isFinite(line.start) && line.start >= 0 &&
        Number.isFinite(line.end) && line.end > line.start,
      ).map((line) => ({ start: line.start, end: line.end, text: line.text.trim() }));
      return res.json({ lyrics, language: result.language, local: true });
    } catch (error) {
      if (res.destroyed || controller.signal.aborted) return;
      if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Local audio chunks must be under 24 MB.' : 'The local audio transfer could not be read.' });
      return res.status(500).json({ error: error.message?.startsWith('The local') || error.message?.startsWith('Local transcription') || error.message?.startsWith('Could not start')
        ? error.message : 'Local transcription failed. Check the installed model and try again.' });
    } finally {
      // The worker resolves/rejects only after it exits, including cancellation.
      busy = false;
      res.removeListener('close', onClose);
    }
  });
  app.post('/api/minus-one', async (req, res) => {
    const status = await transcriber.minusOneStatus?.();
    if (!status?.minusOneAvailable) {
      return res.status(503).json({ error: 'Local vocal removal is not ready. Run pnpm setup:local once. No cloud service is used.' });
    }
    if (busy) return res.status(429).json({ error: 'This computer is already processing a song. Wait for it to finish or stop it first.' });
    busy = true;
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', onClose);
    try {
      await new Promise((resolve, reject) => songUpload.single('audio')(req, res, (error) => error ? reject(error) : resolve()));
      if (!isAudio(req.file)) return res.status(400).json({ error: 'Provide an audio file from the local app.' });
      controller.signal.throwIfAborted();
      const result = await transcriber.separate({ buffer: req.file.buffer, signal: controller.signal });
      if (controller.signal.aborted) return;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', result.buffer.length);
      return res.end(result.buffer);
    } catch (error) {
      if (res.destroyed || controller.signal.aborted) return;
      if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Songs must be under 100 MB.' : 'The local audio transfer could not be read.' });
      return res.status(500).json({ error: /^(The local|Local vocal|Could not start)/.test(error.message ?? '')
        ? error.message : 'Local vocal removal failed. Check the installation and try again.' });
    } finally {
      busy = false;
      res.removeListener('close', onClose);
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((_error, _req, res, _next) => res.status(500).json({ error: 'The local service could not process this request.' }));
  return app;
}
