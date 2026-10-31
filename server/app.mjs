import express from 'express';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 24 * 1024 * 1024, files: 1, fields: 1 } });

export function createApp({ apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch, origin = process.env.APP_ORIGIN } = {}) {
  const app = express();
  app.disable('x-powered-by');
  let busy = false;
  let requests = [];
  const allowedOrigins = new Set(origin ? [origin] : [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:3001', 'http://127.0.0.1:3001',
  ]);
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.get('origin') && !allowedOrigins.has(req.get('origin'))) {
      return res.status(403).json({ error: 'This origin is not allowed to use transcription.' });
    }
    next();
  });
  app.get('/api/status', (_req, res) => res.json({ transcriptionAvailable: Boolean(apiKey), provider: 'OpenAI Whisper' }));
  app.post('/api/transcribe', (req, res, next) => {
    if (!apiKey) return res.status(503).json({ error: 'Automatic transcription is not configured. Add OPENAI_API_KEY to the server .env file, or import timed lyrics.' });
    requests = requests.filter((time) => Date.now() - time < 15 * 60 * 1000);
    if (busy || requests.length >= 30) return res.status(429).json({ error: 'Transcription is busy or the local limit was reached. Please try again later.' });
    busy = true;
    requests.push(Date.now());
    res.once('close', () => { busy = false; });
    next();
  }, upload.single('audio'), async (req, res) => {
    if (!req.file || !/^(audio\/(wav|x-wav|mpeg|mp3|mp4|webm|ogg)|video\/mp4)$/.test(req.file.mimetype)) {
      return res.status(400).json({ error: 'Provide a supported audio file.' });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', onClose);
    try {
      const body = new FormData();
      body.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), 'song.wav');
      body.append('model', 'whisper-1');
      body.append('response_format', 'verbose_json');
      body.append('timestamp_granularities[]', 'segment');
      if (req.body.language && /^[a-z]{2}$/.test(req.body.language)) body.append('language', req.body.language);
      const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body, signal: controller.signal,
      });
      if (!response.ok) {
        const messages = {
          401: 'The server transcription API key is invalid. Check OPENAI_API_KEY.',
          429: 'The transcription provider has reached a usage or billing limit. Check your OpenAI account.',
          413: 'This audio chunk is too large for the transcription provider.',
        };
        return res.status(502).json({ error: messages[response.status] || 'The transcription provider could not process this audio. Please try again.' });
      }
      const result = await response.json();
      const lyrics = (result.segments ?? []).filter((segment) =>
        typeof segment.text === 'string' && Number.isFinite(segment.start) && segment.start >= 0 &&
        Number.isFinite(segment.end) && segment.end > segment.start,
      ).map((segment) => ({ start: segment.start, end: segment.end, text: segment.text.trim() }));
      return res.json({ lyrics, language: result.language });
    } catch (error) {
      if (!res.destroyed) res.status(502).json({ error: error.name === 'AbortError' ? 'Transcription timed out. Please try again.' : 'Could not reach the transcription provider. Check the server connection.' });
    } finally {
      clearTimeout(timeout);
      res.removeListener('close', onClose);
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((error, _req, res, _next) => {
    res.status(error instanceof multer.MulterError ? 400 : 500).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Audio uploads must be under 24 MB per chunk.' : 'The audio upload could not be processed.' });
  });
  return app;
}
