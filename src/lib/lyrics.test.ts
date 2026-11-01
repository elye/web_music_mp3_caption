import { describe, expect, it } from 'vitest';
import { activeLyricIndex, formatTime, nextLyricIndex, normalizeLyrics, parseLrc, parseSrt, parseVtt, titleFromFilename, toLrc } from './lyrics';
import { softenedGain } from './audio';
import { encodeWav } from './transcription';

describe('timed lyrics', () => {
  it('parses repeated LRC timestamps, fractional seconds, metadata, and offset', () => {
    expect(parseLrc('[ar:Artist]\n[offset:500]\n[00:01.5][01:02.050]Hello\n[00:04]World')).toEqual([
      { start: 2, text: 'Hello' }, { start: 4.5, text: 'World' }, { start: 62.55, text: 'Hello' },
    ]);
  });
  it('keeps timed empty lines for instrumental sections, rejects invalid seconds', () => {
    expect(parseLrc('[00:02]Sing\n[00:05]\n[00:99]invalid')).toEqual([{ start: 2, text: 'Sing' }, { start: 5, text: '' }]);
  });
  it('handles negative offsets, sorting, and duplicate lines', () => {
    expect(parseLrc('[offset:-2000]\n[00:05]Later\n[00:01]First\n[00:05]Later')).toEqual([{ start: 0, text: 'First' }, { start: 3, text: 'Later' }]);
  });
  it('reads SRT timestamps, removes presentation tags, and preserves gaps', () => {
    expect(parseSrt('1\r\n00:00:02,500 --> 00:00:05,000\r\n<i>Hello</i>\r\nworld\r\n\r\n2\r\n00:01:00,000 --> 00:01:03,500\r\nAgain')).toEqual([
      { start: 2.5, end: 5, text: 'Hello world' }, { start: 60, end: 63.5, text: 'Again' },
    ]);
  });
  it('parses YouTube WebVTT headers, cue settings, inline tags, and word timestamps', () => {
    const input = String.fromCharCode(0xfeff) + `WEBVTT
Kind: captions
Language: en

00:00:01.200 --> 00:00:03.500 align:start position:0%
<c>Welcome &amp; sing</c>

00:00:03.500 --> 00:00:05.000
<c.colorCCCCCC>to the music</c><00:00:04.000><c> tonight</c>`;
    expect(parseVtt(input)).toEqual([
      { start: 1.2, end: 3.5, text: 'Welcome & sing' },
      { start: 3.5, end: 5, text: 'to the music tonight' },
    ]);
  });
  it('parses hour timestamps and ignores malformed or non-cue blocks', () => {
    expect(parseVtt(`WEBVTT

NOTE generated captions
ignored

intro
01:02:03.004 --> 01:02:05.000
Hello

00:60.000 --> 01:01.000
Invalid`)).toEqual([
      { start: 3723.004, end: 3725, text: 'Hello' },
    ]);
  });
  it('finds the right line at exact boundaries and during instrumental gaps', () => {
    const lyrics = [{ start: 2, end: 4, text: 'A' }, { start: 7, text: 'B' }];
    expect(activeLyricIndex(lyrics, 1)).toBe(-1);
    expect(activeLyricIndex(lyrics, 2)).toBe(0);
    expect(activeLyricIndex(lyrics, 4)).toBe(-1);
    expect(activeLyricIndex(lyrics, 7)).toBe(1);
    expect(activeLyricIndex(lyrics, 7, 1)).toBe(-1);
    expect(activeLyricIndex(lyrics, 8, 1)).toBe(1);
    expect(activeLyricIndex([], 8)).toBe(-1);
    expect(nextLyricIndex(lyrics, 5)).toBe(1);
    expect(nextLyricIndex(lyrics, 10)).toBe(-1);
  });
  it('round-trips captions with instrumental gaps to LRC', () => {
    const lyrics = [{ start: 2.55, end: 4, text: 'A' }, { start: 7, end: 10, text: 'B' }];
    const parsed = parseLrc(toLrc(lyrics));
    expect(parsed).toEqual([{ start: 2.55, text: 'A' }, { start: 4, text: '' }, { start: 7, text: 'B' }, { start: 10, text: '' }]);
  });
  it('rounds timestamps across minute boundaries correctly', () => {
    expect(toLrc([{ start: 59.999, text: 'Hello' }])).toBe('[01:00.00]Hello');
  });
  it('drops invalid numeric timestamps', () => {
    expect(normalizeLyrics([{ start: NaN, text: 'a' }, { start: -1, text: 'b' }, { start: 0, text: ' ok ' }])).toEqual([{ start: 0, text: 'ok' }]);
  });
});

describe('player utilities', () => {
  it('formats valid and unknown durations', () => {
    expect(formatTime(123.8)).toBe('2:03');
    expect(formatTime(3661)).toBe('61:01');
    expect(formatTime(Infinity)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });
  it('extracts filename titles without requiring an artist', () => {
    expect(titleFromFilename('Artist - Song - Live.mp3')).toEqual({ artist: 'Artist', title: 'Song - Live' });
    expect(titleFromFilename('my_song.mp3')).toEqual({ artist: '', title: 'my song' });
  });
  it('softens relative to the selected volume and honors mute', () => {
    expect(softenedGain(0.8, true)).toBeCloseTo(0.176);
    expect(softenedGain(0, true)).toBe(0);
    expect(softenedGain(0.5, false)).toBe(0.5);
    expect(softenedGain(2, false)).toBe(1);
  });
  it('creates a valid mono PCM WAV for transcription', async () => {
    const blob = encodeWav(new Float32Array([-2, 0, 2]), 16000);
    const data = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(50);
    expect(data.getUint32(24, true)).toBe(16000);
    expect(data.getUint16(22, true)).toBe(1);
    expect(data.getInt16(44, true)).toBe(-32768);
    expect(data.getInt16(48, true)).toBe(32767);
  });
});
