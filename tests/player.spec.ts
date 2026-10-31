import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function wav(seconds = 12) {
  const rate = 8000;
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 440) * 1500), 44 + i * 2);
  return buffer;
}

async function importSongs(page: Page, seconds = 12) {
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'The Group - First song.wav', mimeType: 'audio/wav', buffer: wav(seconds) },
    { name: 'The Group - Second song.wav', mimeType: 'audio/wav', buffer: wav(seconds) },
  ]);
  await expect(page.locator('.track-row')).toHaveCount(2);
}

async function instrumentAudio(page: Page) {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as unknown as { testAudio: HTMLMediaElement }).testAudio = this;
      return play.call(this);
    };
    const gain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = gain.call(this);
      (window as unknown as { testGain: GainNode }).testGain = node;
      return node;
    };
  });
}

async function audioPaused(page: Page) {
  return page.evaluate(() => (window as unknown as { testAudio: HTMLMediaElement }).testAudio.paused);
}

test('welcoming empty state, responsive layout, and no unintended uploads', async ({ page }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1') && !request.url().startsWith('blob:')) externalRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add your first songs' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Bring the songs. Sing them together.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/screenshots/desktop-empty.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Bring the songs. Sing them together.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/screenshots/mobile-empty.png', fullPage: true });
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('imports a queue, edits lyrics, adjusts captions, reorders, and restores locally', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add your first songs' })).toBeEnabled();
  await importSongs(page);
  await page.locator('.lyric-actions').getByRole('button', { name: 'Add lyrics' }).click();
  await page.getByLabel('Timed lyrics').fill('[00:00.00]Here together, we belong\n[00:04.00]Every voice can sing along');
  await page.getByRole('button', { name: 'Save lyrics' }).click();
  await expect(page.locator('.current-lyric')).toHaveText('Here together, we belong');
  const initialSize = await page.locator('.current-lyric').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.getByRole('button', { name: 'Larger lyrics' }).click();
  expect(await page.locator('.current-lyric').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(initialSize);
  await page.getByRole('button', { name: 'Move Second song up' }).click({ force: true });
  await expect(page.locator('.track-row').first()).toContainText('Second song');
  await page.reload();
  await expect(page.locator('.track-row')).toHaveCount(2);
  await expect(page.locator('.track-row').first()).toContainText('Second song');
  await page.getByRole('button', { name: 'Select First song' }).click();
  await expect(page.locator('.current-lyric')).toHaveText('Here together, we belong');
  await page.screenshot({ path: 'test-results/screenshots/desktop-lyrics.png', fullPage: true });
  await page.getByRole('button', { name: 'Remove First song' }).click({ force: true });
  await page.getByRole('button', { name: 'Keep song' }).click();
  await expect(page.locator('.track-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove First song' }).click({ force: true });
  await page.getByRole('button', { name: 'Remove song', exact: true }).click();
  await expect(page.locator('.track-row')).toHaveCount(1);
});

test('pause fades without removing or restarting; soften, mute, and fullscreen work', async ({ page }) => {
  await instrumentAudio(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Or try a 32-second soundcheck' }).click();
  await expect(page.getByRole('button', { name: 'Pause with fade' })).toBeEnabled();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Soften', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { testGain: GainNode }).testGain.gain.value)).toBeCloseTo(0.176, 2);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { testGain: GainNode }).testGain.gain.value)).toBeCloseTo(0.8, 2);
  await page.getByRole('button', { name: 'Pause with fade' }).click();
  expect(await audioPaused(page)).toBe(false);
  await expect(page.locator('.stage-label')).toHaveText('FADING TO PAUSE');
  await expect.poll(() => audioPaused(page)).toBe(true);
  const pausedTime = await page.evaluate(() => (window as unknown as { testAudio: HTMLMediaElement }).testAudio.currentTime);
  expect(pausedTime).toBeGreaterThan(2);
  await expect(page.locator('.track-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => audioPaused(page)).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { testAudio: HTMLMediaElement }).testAudio.currentTime)).toBeGreaterThanOrEqual(pausedTime);
  await page.getByRole('slider', { name: 'Volume', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => (window as unknown as { testGain: GainNode }).testGain.gain.value)).toBeCloseTo(0, 3);
  await page.getByRole('button', { name: 'Fullscreen', exact: false }).click();
  await expect(page.locator('.app')).toHaveClass(/presenting/);
  await page.screenshot({ path: 'test-results/screenshots/fullscreen.png', fullPage: true });
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(page.locator('.app')).not.toHaveClass(/presenting/);
});

test('auto-advance countdown can be paused and the queue ends cleanly', async ({ page }) => {
  await instrumentAudio(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add your first songs' })).toBeEnabled();
  await importSongs(page, 2);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.countdown')).toBeVisible();
  await page.getByRole('button', { name: 'Pause auto-advance' }).click();
  await page.waitForTimeout(3500);
  await expect(page.locator('.track-row.selected')).toContainText('First song');
  expect(await audioPaused(page)).toBe(true);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.track-row.selected')).toContainText('Second song');
  await expect(page.getByText('You’ve reached the end of your queue.')).toBeVisible();
  await expect(page.locator('.track-row')).toHaveCount(2);
});

test('only transcribes after explicit consent and stores returned captions', async ({ page }) => {
  let transcriptions = 0;
  await page.route('**/api/status', (route) => route.fulfill({ json: { transcriptionAvailable: true } }));
  await page.route('**/api/transcribe', (route) => {
    transcriptions++;
    return route.fulfill({ json: { lyrics: [{ start: 0, end: 4, text: 'A mocked transcription for testing' }] } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add your first songs' })).toBeEnabled();
  await importSongs(page, 5);
  expect(transcriptions).toBe(0);
  await page.locator('.queue-bottom').getByRole('button', { name: 'Generate lyrics' }).click();
  await expect(page.getByText('Your choice, every time.')).toBeVisible();
  expect(transcriptions).toBe(0);
  await page.getByRole('button', { name: 'Transcribe 2 songs' }).click();
  await expect(page.getByText('Finished. Review the words and timing before your session.')).toBeVisible();
  expect(transcriptions).toBe(2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.current-lyric')).toHaveText('A mocked transcription for testing');
  await expect(page.getByText('2 of 2 songs with lyrics')).toBeVisible();
});

test('transcription setup is honest and timed subtitle import works without a key', async ({ page }) => {
  await page.route('**/api/status', (route) => route.fulfill({ json: { transcriptionAvailable: false } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add your first songs' })).toBeEnabled();
  await importSongs(page);
  await page.locator('.queue-bottom').getByRole('button', { name: 'Generate lyrics' }).click();
  await expect(page.getByText('One-time setup needed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transcribe 2 songs' })).toBeDisabled();
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.locator('.lyric-actions').getByRole('button', { name: 'Add lyrics' }).click();
  await page.locator('dialog input[type=file]').setInputFiles({ name: 'words.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:03,000\nSing together\n\n2\n00:00:05,000 --> 00:00:08,000\nKeep singing') });
  await expect(page.getByLabel('Timed lyrics')).toHaveValue(/Sing together/);
  await page.getByRole('button', { name: 'Save lyrics' }).click();
  await expect(page.locator('.current-lyric')).toHaveText('Sing together');
});

test('plays an actual MP3 file', async ({ page }) => {
  let ffmpeg = true;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
  test.skip(!ffmpeg, 'Optional MP3 smoke test requires ffmpeg. Other playback tests use WAV.');
  const directory = mkdtempSync(join(tmpdir(), 'chorus-mp3-'));
  try {
    writeFileSync(join(directory, 'source.wav'), wav(4));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(directory, 'source.wav'), join(directory, 'song.mp3')], { stdio: 'pipe' });
    await instrumentAudio(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Add your first songs' })).toBeEnabled();
    await page.locator('input[type=file]').first().setInputFiles({ name: 'Actual MP3.mp3', mimeType: 'audio/mpeg', buffer: readFileSync(join(directory, 'song.mp3')) });
    await expect(page.locator('.track-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => audioPaused(page)).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as unknown as { testAudio: HTMLMediaElement }).testAudio.currentTime)).toBeGreaterThan(0.1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('automatically advances without a gap and repeats the queue', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add your first songs' })).toBeEnabled();
  await importSongs(page, 2);
  await page.getByRole('button', { name: 'Session settings' }).click();
  await page.getByLabel('Gap between songs').selectOption('0');
  await page.getByRole('switch', { name: 'Repeat the queue' }).click();
  await page.getByRole('button', { name: 'All set' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.track-row.selected')).toContainText('Second song');
  await expect(page.locator('.track-row.selected')).toContainText('First song');
  await expect(page.getByRole('button', { name: 'Pause with fade' })).toBeVisible();
});

test('pausing near a track ending does not accidentally start the next song', async ({ page }) => {
  await instrumentAudio(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add your first songs' })).toBeEnabled();
  await importSongs(page, 2);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Pause with fade' }).click();
  await page.waitForTimeout(1500);
  await expect(page.locator('.track-row.selected')).toContainText('First song');
  await expect(page.locator('.countdown')).toHaveCount(0);
  expect(await audioPaused(page)).toBe(true);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.track-row.selected')).toContainText('Second song');
});

test('keyboard controls, lyric delay, and mobile settings stay usable', async ({ page }) => {
  await instrumentAudio(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Or try a 32-second soundcheck' }).click();
  await page.locator('.stage-label').click();
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await expect.poll(() => audioPaused(page)).toBe(true);
  await page.getByRole('button', { name: 'Show lyrics 0.5 seconds later' }).click();
  await expect(page.locator('.offset-controls .mono')).toHaveText('+0.5s');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Session settings' }).click();
  await page.getByRole('slider', { name: 'Music volume' }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('slider', { name: 'Music volume' })).toHaveValue('0');
  await page.getByRole('switch', { name: 'High-contrast lyrics' }).click();
  await page.getByRole('button', { name: 'All set' }).click();
  await expect(page.locator('.app')).toHaveClass(/high-contrast/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('failed transcription preserves existing lyrics', async ({ page }) => {
  await page.route('**/api/status', (route) => route.fulfill({ json: { transcriptionAvailable: true } }));
  await page.route('**/api/transcribe', (route) => route.fulfill({ status: 502, json: { error: 'Test provider unavailable' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Or try a 32-second soundcheck' }).click();
  await page.locator('.queue-bottom').getByRole('button', { name: 'Generate lyrics' }).click();
  await expect(page.getByText('Existing lyrics will be replaced after success.')).toBeVisible();
  await page.getByRole('button', { name: 'Transcribe song' }).click();
  await expect(page.getByText('Test provider unavailable')).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('4 lines · Timed lyrics ready')).toBeVisible();
});
