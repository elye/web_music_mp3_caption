# Chorus — sing together

An **entirely local** sing-along app for small groups: local MP3s, local storage, local Whisper transcription, and a local vocal remover for making minus-one backing tracks. Nothing is sent to a cloud service. A loopback-only helper runs on the same computer as the browser; there is no hosted backend, API key, or paid transcription service.

Built with React, TypeScript, Vite, Web Audio, IndexedDB, Express, and CPU-only `faster-whisper` and Demucs.

## Run it

Requires **Node.js 22+**, **pnpm**, and **Python 3.10–3.13** for transcription. No GPU or system FFmpeg installation is required for the app; the Python audio library bundles decoding support.

```sh
pnpm install
pnpm setup:local       # One-time download: Whisper small model + Demucs vocal remover (~1.8 GB total)
pnpm dev
```

Open **http://127.0.0.1:5173**. The dev command starts Vite and the **localhost-only** helper (port 3001). After setup, disconnect from the internet: playback, transcription, editing, and lyric export still work. Only the initial installation/model download needs internet; see the air-gapped setup below for machines that cannot connect at all.

You may skip `setup:local` if you only want playback and imported/manual lyrics. To install only one feature, use `pnpm setup:local --skip-minus-one` (no PyTorch, much smaller) or `pnpm setup:local --skip-transcription`. Restart after changing server code or environment variables; frontend changes hot-reload. Keep the same hostname and port to retain access to your browser's saved queue.

For a production build served locally:

```sh
pnpm build
pnpm start
```

Open **http://127.0.0.1:3001**. Express serves the built app and local transcription endpoint on loopback. This is the simplest offline day-to-day mode; the production page's Content Security Policy blocks remote connections. The production address has its own browser storage, separate from the development address.

## What it does

- Import one or many MP3s by file picker or drag-and-drop. WAV, M4A, OGG, FLAC, AAC, and WebM are also accepted when the browser can decode them. Maximum 100 MB per file.
- Save audio, lyrics, queue order, and preferences locally. Reloading restores the queue **paused**; it never starts playing unexpectedly.
- Play tracks sequentially with a selectable 0 / 3 / 5 / 10 second gap. A countdown can be paused or skipped. Repeat the queue if desired.
- Display a large active lyric line, the previous line, and the next line. Instrumental gaps and lyric count-ins are supported.
- Project lyrics in fullscreen. Browsers without fullscreen use an in-page stage view. Screen Wake Lock is used during fullscreen playback where available.
- Adjust caption size, enable high contrast, and shift lyric timing ±30 seconds in 0.5-second steps. A positive lyric delay makes captions appear later.
- Pause with a 0.6 / 1.2 / 2.5 second gain fade, preserving the song and playback position. Resume fades back in. The playback clock continues during the fade itself.
- Soften temporarily to **22% of the chosen volume**; restore with a second tap. Soften is not mute. The volume slider can mute completely.
- Tune each song up or down by up to 6 semitones, live, without changing its speed. The tuning applies to the original and the minus-one together and is remembered per song. The key is estimated locally from the audio the first time a song loads and shown as a readout (for example “G major → A major”); a trailing “?” marks a low-confidence guess. Pitch shifting keeps voices natural (formants stay put, so raised voices don't turn into chipmunks) using Signalsmith Stretch (MIT, WASM in an AudioWorklet), loaded only when a song is first tuned; if it can't load, SoundTouch (MPL-2.0) is used instead. The production page's Content Security Policy allows `wasm-unsafe-eval` for this; no remote or `blob:` scripts are permitted. Large shifts still sound more processed.
- Reorder tracks with up/down controls. Removal requires confirmation, and the currently playing song cannot be removed until paused. Original files on disk are never deleted.
- Try the built-in 32-second instrumental soundcheck with original practice lyrics. It is synthesized on your device, not a recording of sung vocals.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / fade to pause; pause an auto-advance countdown |
| M | Soften / restore |
| F | Enter / exit fullscreen |
| V | Switch between the original and the minus-one |
| Left / Right | Seek backward / forward 5 seconds |
| Escape | Close a dialog or exit fullscreen / stage view |

Shortcuts do not intercept typing or focused native controls. Range inputs support native keyboard navigation.

## Add the words

### 1. Import timed lyrics — no API or internet required

Choose a song, click **Add lyrics**, then import an `.lrc`, `.srt`, or `.vtt` file, including YouTube WebVTT captions. Conversion happens in your browser. You can edit the words/times and export an `.lrc` backup.

Example LRC:

```text
[00:05.00]The first line goes here
[00:12.50]And then the next line
[00:18.00]
[00:24.00]A line after the instrumental break
```

Repeated timestamps and `[offset:milliseconds]` metadata are supported. SRT and WebVTT end times are converted into blank timed lines to preserve instrumental gaps.

### 2. Time your own lyrics

Paste one plain lyric line per row in the editor. Play the song and press **Stamp next line** when each line starts. Save when all lines have timestamps. Edit timestamps directly for corrections. Song title and artist/note are editable too.

### 3. Generate lyrics automatically — on your computer

After `pnpm setup:local`, choose **Generate lyrics → Transcribe**. The dialog shows the installed model and offline-ready status. If you finish setup while the app is open, click **Check again**; no application restart is needed just to detect the model.

The queue-wide button processes tracks missing lyrics. If every track already has lyrics, the dialog offers to replace them. Successful results are saved per song; a failed or cancelled request never erases existing lyrics. You can stop processing and retry unfinished songs.

**What runs where:**

1. Your browser reads the local MP3, resamples it to mono PCM, and sends six-minute chunks over **loopback only**, to `127.0.0.1` on the same computer.
2. The helper starts a local Python worker. `faster-whisper` reads the installed model from disk and transcribes on your CPU using int8 inference, with word-level timestamps.
3. The worker groups words into caption lines at pauses (0.9 seconds), with a 42-character or 8-second line limit. Timed lyrics return to your browser and are saved in IndexedDB. No external service receives the audio, lyrics, or metadata.

**Offline guarantees and boundaries:**

- Runtime model loading uses a **local directory only**, `local_files_only=True`, `HF_HUB_OFFLINE=1`, and `TRANSFORMERS_OFFLINE=1`. Telemetry is disabled. The worker also rejects Python socket connections and DNS lookups. Missing files produce a setup error, never a download or cloud fallback.
- Only the explicitly invoked **setup script** accesses package/model registries. It downloads public packages and models, not your songs. No API key is needed.
- The virtual environment, package caches, Whisper weights, Demucs weights, and temporary audio all live under the git-ignored `.local-transcription/` folder. Deleting that folder removes the downloaded models and local runtime; global Python is not modified.
- For processing, private temporary WAV files are written under `.local-transcription/tmp/` with restrictive permissions on POSIX. They are removed after success, failure, or normal cancellation. Abrupt computer/process termination can leave temporary files there; delete stale contents when the app is stopped. This is ordinary local disk storage, not encrypted storage.
- One worker runs at a time to avoid exhausting your computer. Cancellation terminates it and keeps the slot occupied until it actually exits. There is no paid usage limit. The default timeout is 20 minutes **per chunk**, not per whole song.
- Automatic transcription supports songs up to **20 minutes** to limit browser memory use. Longer tracks still play with imported lyrics. Local processing can be slower than playback, particularly on older CPUs; prepare the queue before the gathering.
- Whisper recognizes speech, not perfectly aligned singing. Backing instruments, overlapping vocals, reverberation, and instrumental breaks can produce missing or invented lyrics. **Review and correct the words and timing.** Captions are line/segment-timed, not word-highlighted. Chunk boundaries can split phrases.
- Only use songs/lyrics you have permission to display.

## Minus-one: sing over the band

A **minus-one** is the song with the singer removed. Chorus makes it on your computer with Demucs (`htdemucs`) and keeps it beside the original.

1. Choose **Make minus-one** in the queue. It processes songs that do not have one yet, or offers to replace them all. Or click **Minus-one** in the player when a song has none.
2. Wait. Roughly a fraction of the song's length up to about its full length on a typical CPU. You can stop at any time; finished songs are saved, and a failed or cancelled run never removes an existing minus-one.
   **Already have a minus-one?** In the same dialog, choose **Upload your own** next to **Generate** (when several songs are listed, use the link under each song) (MP3, WAV, M4A, OGG, FLAC, AAC, or WebM, up to 100 MB). It is saved in this browser only and never sent to the helper, so it works without `setup:local`. Chorus warns if its length differs from the original by more than 2 seconds, since it may drift out of sync with the lyrics. Downloads keep the uploaded file's format.
3. Switch between **Original** and **Minus-one** in the player bar (or press **V**) at any time, including mid-song. The switch is a 50 ms crossfade with no gap: both versions play together in step (the original is the clock, and the minus-one is kept silently aligned, with drift corrected by an imperceptible speed nudge), so nothing reloads or seeks. This uses about twice the decoding of one version while a song with a minus-one plays. The choice is remembered for other songs that have a minus-one.

**Download.** Choose **Download** under the stage for the original file, the minus-one MP3, and the `.lrc` lyrics. The original is exactly the file you imported.

**What runs where:** the browser sends the song to `127.0.0.1` only. The helper decodes it with the bundled PyAV, separates it into drums, bass, other, and vocals, sums everything except the vocals, and encodes a 192 kbps stereo MP3 that comes back to the browser and is saved in IndexedDB. The worker has the same offline guards as transcription (network calls fail, weights load only from `.local-transcription/cache/torch/`) and its temporary files are removed after success, failure, or cancellation. Minus-one and transcription share one worker slot, so only one job runs at a time.

**Limits:** songs up to **15 minutes** (memory). The default timeout is 30 minutes per song (`LOCAL_SEPARATION_TIMEOUT_SECONDS`). Separation is not perfect: faint vocal traces, backing vocals, and thinned-out centre-panned instruments can remain or be affected. The minus-one is re-encoded as a 192 kbps MP3, and a few tens of milliseconds of encoder delay can shift it slightly against the original. Only use songs you have permission to process.

On Linux the default PyTorch wheel includes GPU libraries (about 2 GB). For a smaller CPU-only install, run `.local-transcription/venv/bin/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu` before `pnpm setup:local`.

### Choose a local model

```sh
pnpm setup:local --model tiny    # ~75 MB; fastest, least accurate
pnpm setup:local --model base    # ~145 MB; smaller and faster, but less accurate
pnpm setup:local --model small   # ~490 MB; default, better recognition, more CPU/RAM
pnpm setup:local --model medium  # ~1.5 GB; potentially better recognition, substantially more CPU/RAM
```

All choices are multilingual. Fresh setup defaults to `small`. If an earlier setup selected another model, rerun `pnpm setup:local` to download and select `small`; setup verifies offline model loading, WAV decoding, and a short inference before switching, so a failed upgrade keeps the previous selection. Model weights remain on disk for later offline use. Recognition quality on songs is not guaranteed even with larger models.

Optional `.env` settings are described in `.env.example`: CPU thread count (default 4), worker timeouts, a previously downloaded model, or an existing compatible Python executable. No credentials are used.

### Prepare a completely disconnected machine

Use a connected computer with the **same OS, CPU architecture, and Python minor version** as the target:

1. Run `pnpm install`, `pnpm setup:local --model small`, and `pnpm build`.
2. Prepare Python wheels (using the Python environment created above):

   ```sh
   .local-transcription/venv/bin/python -m pip download -r server/requirements-local.txt -r server/requirements-minus-one.txt --dest offline-wheels
   ```

   On Windows, use `.local-transcription/venv/Scripts/python.exe` instead.
3. Copy the project, including `dist/`, `node_modules/`, `.local-transcription/models/`, `.local-transcription/cache/torch/` (the Demucs weights), and `offline-wheels/`, to the disconnected computer. Include its source files and package files. Do **not** rely on copying the virtual environment: virtual environments contain machine-specific paths. Install Node, pnpm, and a matching Python on the target in advance.
4. On the disconnected computer:

   ```sh
   pnpm setup:local --offline --wheels ./offline-wheels --model small
   pnpm start
   ```

The `--offline` flag uses pip's `--no-index`, never calls the model registry, and fails if required files are missing. This can also verify an already-installed environment: `pnpm setup:local --offline`. Keep all model files, including the tokenizer and vocabulary; copying just `model.bin` is not enough.

## Local storage and deployment boundaries

Audio blobs (original and minus-one), lyrics, and order are saved in **IndexedDB** under the browser origin. Preferences use `localStorage`. Nothing is synced to an account. Browser storage is best-effort: private browsing, low disk space, eviction, clearing site data, or switching browsers/origins may remove or hide the queue. Storage failures are reported and session playback remains available. Keep original MP3s and export valuable LRC edits. Multiple open tabs are not synchronized; use one leader tab per session.

The server binds to **127.0.0.1**, not your network interfaces. The shipped app is intended to run on the leader's computer and project/mirror that screen. It does **not** synchronize separate audience devices.

This is **not a public multi-user service**, and it should not be exposed through a tunnel or reverse proxy. The API rejects non-local browser origins, and the frontend refuses transcription from non-loopback hostnames. Anyone using it runs their own local instance and model. For a custom local port, update `PORT` and the Vite proxy consistently. It is not a browser-only app: keep the localhost helper running on the same computer. A phone opening another computer's server would not be on-device transcription and is intentionally not the supported mode.

Modern desktop Chrome/Edge is the primary tested target. Safari/mobile browser policies can restrict autoplay, fullscreen, wake locks, background playback, and large audio decoding. The first playback requires a user gesture. A focused stage fallback is available when native fullscreen is denied. Fonts are bundled locally; the app needs its local server running, but playback does not need internet once dependencies are installed.

## Tests

```sh
pnpm test        # Lyric parsing/timing, local-worker lifecycle, and API tests
pnpm build       # Type-check and production bundle
pnpm test:e2e    # Playwright browser acceptance tests
pnpm test:local  # Real installed-model inference + offline worker checks
# On macOS with a local Samantha voice and ffmpeg, after building:
CHORUS_TEST_LOCAL=1 pnpm test:e2e  # Also test the built app with real local transcription
```

Browser tests use installed Google Chrome on macOS if found; otherwise install Playwright Chromium with `pnpm exec playwright install chromium` during initial setup. An optional real-MP3 smoke test uses `ffmpeg`; the app itself does not require it. Browser/API tests use synthetic audio and a test local worker, never a cloud provider. `test:local` runs actual model inference, verifies the worker's network guard, and on macOS tests recognition of a locally synthesized voice if `say` and `ffmpeg` are available. It requires `setup:local` to have completed; it never installs/downloads a model itself.

Coverage includes local-only requests, setup/retry UX, cleanup and cancellation, busy-worker protection, queue persistence, fade/soften/mute, fullscreen, timed lyrics, automatic transitions, repeat, mobile layouts, and MP3 decoding. Screenshots and traces are in the ignored `test-results/` folder.

## Project map

```text
src/App.tsx                     Session UI and queue orchestration
src/styles.css                  Responsive stage, player, and dialogs
src/lib/audio.ts                Persistent audio element and gain ramps
src/lib/lyrics.ts               LRC/SRT/WebVTT parsing, export, lyric lookup
src/lib/storage.ts              IndexedDB audio/lyrics and local preferences
src/lib/transcription.ts        Audio preparation and transcription chunks
src/lib/minusOne.ts             Minus-one request and file downloads
src/lib/demo.ts                 Original synthesized soundcheck
src/components/LyricsEditor.tsx Import, edit, timestamp, export
src/components/TranscriptionDialog.tsx  Consent and batch progress
src/components/MinusOneDialog.tsx       Minus-one generation
src/components/DownloadDialog.tsx       Original, minus-one, and LRC downloads
server/app.mjs                  Loopback-only transcription and minus-one endpoints
server/local-transcriber.mjs    Worker lifecycle, cancellation, temporary-file cleanup
server/transcribe_local.py      Offline-only CPU Whisper inference
server/separate_local.py        Offline-only CPU Demucs vocal removal
scripts/setup_local.py          Explicit one-time download / air-gapped setup
server/index.mjs                Localhost app server with local-only production CSP
```
