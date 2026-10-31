# Chorus — sing together

A local-first sing-along web app for small groups. Bring a few MP3s, prepare the words, and let the queue carry the evening. Built with React, TypeScript, Vite, Web Audio, IndexedDB, and a small Express transcription API.

## Run it

Requires **Node.js 22+** and **pnpm**.

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. The dev command starts both Vite and the local API (port 3001). Restart it after changing server code or environment variables; frontend changes hot-reload. Keep the same hostname and port to retain access to your browser's saved queue.

For a production build served locally:

```sh
pnpm build
pnpm start
```

Open **http://127.0.0.1:3001**. The app and API are both served by Express. The production address has its own browser storage, separate from the development address.

## What it does

- Import one or many MP3s by file picker or drag-and-drop. WAV, M4A, OGG, FLAC, AAC, and WebM are also accepted when the browser can decode them. Maximum 100 MB per file.
- Save audio, lyrics, queue order, and preferences locally. Reloading restores the queue **paused**; it never starts playing unexpectedly.
- Play tracks sequentially with a selectable 0 / 3 / 5 / 10 second gap. A countdown can be paused or skipped. Repeat the queue if desired.
- Display a large active lyric line, the previous line, and the next line. Instrumental gaps and lyric count-ins are supported.
- Project lyrics in fullscreen. Browsers without fullscreen use an in-page stage view. Screen Wake Lock is used during fullscreen playback where available.
- Adjust caption size, enable high contrast, and shift lyric timing ±30 seconds in 0.5-second steps. A positive lyric delay makes captions appear later.
- Pause with a 0.6 / 1.2 / 2.5 second gain fade, preserving the song and playback position. Resume fades back in. The playback clock continues during the fade itself.
- Soften temporarily to **22% of the chosen volume**; restore with a second tap. Soften is not mute. The volume slider can mute completely.
- Reorder tracks with up/down controls. Removal requires confirmation, and the currently playing song cannot be removed until paused. Original files on disk are never deleted.
- Try the built-in 32-second instrumental soundcheck with original practice lyrics. It is synthesized on your device, not a recording of sung vocals.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / fade to pause; pause an auto-advance countdown |
| M | Soften / restore |
| F | Enter / exit fullscreen |
| Left / Right | Seek backward / forward 5 seconds |
| Escape | Close a dialog or exit fullscreen / stage view |

Shortcuts do not intercept typing or focused native controls. Range inputs support native keyboard navigation.

## Add the words

### 1. Import timed lyrics — no API or internet required

Choose a song, click **Add lyrics**, then import an `.lrc` or `.srt` file. You can edit the words/times and export an `.lrc` backup.

Example LRC:

```text
[00:05.00]The first line goes here
[00:12.50]And then the next line
[00:18.00]
[00:24.00]A line after the instrumental break
```

Repeated timestamps and `[offset:milliseconds]` metadata are supported. SRT end times are converted into blank timed lines to preserve instrumental gaps.

### 2. Time your own lyrics

Paste one plain lyric line per row in the editor. Play the song and press **Stamp next line** when each line starts. Save when all lines have timestamps. Edit timestamps directly for corrections. Song title and artist/note are editable too.

### 3. Generate lyrics automatically — optional, paid provider

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY` to your OpenAI API key. Do not add a `VITE_` prefix: the key belongs only on the server.
3. Restart `pnpm dev` (or `pnpm start`).
4. Click **Generate lyrics**, review the upload notice, then click **Transcribe**.

The queue-wide button processes tracks missing lyrics. If every track already has lyrics, the dialog explicitly offers to replace them. Successful results are saved per song; a failed or cancelled request never erases existing lyrics. You can stop processing and retry unfinished songs.

**Important limitations and privacy details:**

- No audio is uploaded until you explicitly click **Transcribe**. Normal playback, local fonts, imported captions, and editing do not need an external connection.
- Automatic transcription sends audio to **OpenAI Whisper (`whisper-1`)**. Provider usage charges and OpenAI's data handling policies apply. Review those policies before uploading private recordings.
- The browser decodes audio to mono PCM and uploads it in six-minute chunks (approximately 11 MB at 16 kHz). The server forwards it to a fixed provider endpoint. It does not intentionally write audio or API keys to disk or log audio/transcripts.
- Automatic transcription currently supports songs up to **20 minutes**, to limit browser memory use. Longer tracks can still play with imported timed lyrics.
- Whisper is a speech recognizer, not a dedicated music alignment system. Backing instruments, reverberation, overlapping vocals, and instrumental sections can cause missing or invented words. **Review and correct the generated lyrics and timing before a gathering.** Chunk boundaries can split phrases.
- Captions synchronize **by line/segment**, not by individual highlighted word. Some language recognition and segment breaks will need manual correction.
- API requests have a 24 MB upload limit, a three-minute provider timeout, a one-request-at-a-time limit, and a local limit of 30 requests per 15 minutes. Each chunk counts as a request. Processing stops on the first failed chunk for that song.
- Cancelling stops further uploads and aborts the current request where possible; it cannot undo data already sent or guaranteedly cancel provider charges.
- Only upload and display songs/lyrics you have permission to use.

## Local storage and deployment boundaries

Audio blobs, lyrics, and order are saved in **IndexedDB** under the browser origin. Preferences use `localStorage`. Nothing is synced to an account. Browser storage is best-effort: private browsing, low disk space, eviction, clearing site data, or switching browsers/origins may remove or hide the queue. Storage failures are reported and session playback remains available. Keep original MP3s and export valuable LRC edits. Multiple open tabs are not synchronized; use one leader tab per session.

The server binds to **127.0.0.1**, not your network interfaces. The shipped app is intended to run on the leader's computer and project/mirror that screen. It does **not** synchronize separate audience devices.

This is **not a public multi-user service**. Before exposing it on a network, add authentication, per-user quotas, HTTPS, appropriate retention controls, and a production reverse proxy. `APP_ORIGIN` can restrict the allowed browser origin; it is not authentication. For a custom local port, update `PORT`, the Vite proxy, and `APP_ORIGIN` consistently.

Modern desktop Chrome/Edge is the primary tested target. Safari/mobile browser policies can restrict autoplay, fullscreen, wake locks, background playback, and large audio decoding. The first playback requires a user gesture. A focused stage fallback is available when native fullscreen is denied. Fonts are bundled locally; the app needs its local server running, but playback does not need internet once dependencies are installed.

## Tests

```sh
pnpm test        # Lyric parsing/timing, audio encoding, and API tests
pnpm build       # Type-check and production bundle
pnpm test:e2e    # Playwright browser acceptance tests
```

Browser tests use the installed Google Chrome on macOS if found; otherwise install Playwright Chromium using `pnpm exec playwright install chromium`. An optional real-MP3 smoke test uses `ffmpeg` when installed; the rest generate small WAV fixtures. Tests use temporary browser profiles and synthetic audio, not your personal files. The transcription provider is mocked in tests, so testing does not upload audio or incur charges.

Browser coverage includes empty/mobile layouts, no external requests during normal use, import/persistence/reordering, safe removal, lyric edits and SRT import, caption sizing, fade/resume behavior, soften/restore/mute, fullscreen, sequential playback, paused countdowns, explicit transcription consent, unavailable-provider setup, and real MP3 decoding. Screenshots and traces are written to the ignored `test-results/` folder.

## Project map

```text
src/App.tsx                     Session UI and queue orchestration
src/styles.css                  Responsive stage, player, and dialogs
src/lib/audio.ts                Persistent audio element and gain ramps
src/lib/lyrics.ts               LRC/SRT parsing, export, lyric lookup
src/lib/storage.ts              IndexedDB audio/lyrics and local preferences
src/lib/transcription.ts        Audio preparation and transcription chunks
src/lib/demo.ts                 Original synthesized soundcheck
src/components/LyricsEditor.tsx Import, edit, timestamp, export
src/components/TranscriptionDialog.tsx  Consent and batch progress
server/app.mjs                  Bounded, server-side transcription proxy
server/index.mjs                API and production static server
```
