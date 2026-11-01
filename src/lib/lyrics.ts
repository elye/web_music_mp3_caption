import type { LyricLine } from '../types';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Read standard LRC, including repeated timestamps and a millisecond offset. */
export function parseLrc(input: string): LyricLine[] {
  const offset = Number(input.match(/\[offset:\s*(-?\d+)\]/i)?.[1] ?? 0) / 1000;
  const lines: LyricLine[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const timestamps = [...raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    // Blank timed entries deliberately clear the display for instrumental sections.
    for (const timestamp of timestamps) {
      const seconds = Number(timestamp[2]);
      if (seconds >= 60) continue;
      const fraction = timestamp[3] ? Number(`0.${timestamp[3]}`) : 0;
      lines.push({ start: Math.max(0, Number(timestamp[1]) * 60 + seconds + fraction + offset), text });
    }
  }
  return normalizeLyrics(lines);
}

export function parseSrt(input: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const stamp = '(\\d{1,2}):(\\d{2}):(\\d{2})[,.](\\d{3})';
  const timing = new RegExp(`${stamp}\\s*-->\\s*${stamp}`);
  for (const block of input.replace(/\r/g, '').split(/\n\s*\n/)) {
    const rows = block.split('\n');
    const index = rows.findIndex((line) => timing.test(line));
    if (index === -1) continue;
    const match = rows[index].match(timing)!;
    const seconds = (n: number) => Number(match[n]) * 3600 + Number(match[n + 1]) * 60 + Number(match[n + 2]) + Number(match[n + 3]) / 1000;
    const start = seconds(1);
    const end = seconds(5);
    if (end <= start) continue;
    lines.push({ start, end, text: rows.slice(index + 1).join(' ').replace(/<[^>]+>/g, '').trim() });
  }
  return normalizeLyrics(lines);
}

/** Read WebVTT cues, including YouTube cue settings and inline word-timing tags. */
export function parseVtt(input: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const timestamp = (value: string): number | undefined => {
    if (!/^(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}$/.test(value)) return undefined;
    const parts = value.split(/[:.]/);
    if (parts.length === 3) {
      const [minutes, seconds, milliseconds] = parts.map(Number);
      if (seconds >= 60) return undefined;
      return minutes * 60 + seconds + milliseconds / 1000;
    }
    if (parts.length === 4) {
      const [hours, minutes, seconds, milliseconds] = parts.map(Number);
      if (minutes >= 60 || seconds >= 60) return undefined;
      return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    }
    return undefined;
  };
  const decodeText = (text: string) => text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&lrm;/g, '').replace(/&rlm;/g, '')
    .trim();

  for (const block of input.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const rows = block.split('\n');
    const index = rows.findIndex((line) => line.includes('-->'));
    if (index === -1) continue;
    const match = rows[index].match(/^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if (!match) continue;
    const start = timestamp(match[1]);
    const end = timestamp(match[2]);
    if (start === undefined || end === undefined || end <= start) continue;
    const text = decodeText(rows.slice(index + 1).join(' '));
    lines.push({ start, end, text });
  }
  return normalizeLyrics(lines);
}

export function normalizeLyrics(lines: LyricLine[]): LyricLine[] {
  return lines
    .filter((line) => Number.isFinite(line.start) && line.start >= 0 && typeof line.text === 'string')
    .map((line) => ({ ...line, text: line.text.trim() }))
    .sort((a, b) => a.start - b.start)
    .filter((line, i, all) => i === 0 || line.start !== all[i - 1].start || line.text !== all[i - 1].text);
}

/** A positive offset delays the captions. End timestamps leave instrumental gaps. */
export function activeLyricIndex(lines: LyricLine[], time: number, offset = 0): number {
  const position = time - offset;
  let low = 0;
  let high = lines.length - 1;
  let match = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].start <= position) {
      match = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  if (match >= 0 && lines[match].end !== undefined && position >= lines[match].end!) return -1;
  return match;
}

export function nextLyricIndex(lines: LyricLine[], time: number, offset = 0): number {
  return lines.findIndex((line) => line.start > time - offset && line.text.length > 0);
}

export function toLrc(lines: LyricLine[]): string {
  const stamp = (seconds: number) => {
    const hundredths = Math.round(seconds * 100);
    return `[${String(Math.floor(hundredths / 6000)).padStart(2, '0')}:${(hundredths % 6000 / 100).toFixed(2).padStart(5, '0')}]`;
  };
  const withGaps = lines.flatMap((line, i) => {
    const result = [{ start: line.start, text: line.text }];
    if (line.end !== undefined && (!lines[i + 1] || line.end < lines[i + 1].start)) {
      result.push({ start: line.end, text: '' });
    }
    return result;
  });
  return withGaps.map((line) => `${stamp(line.start)}${line.text}`).join('\n');
}

export function titleFromFilename(filename: string): { title: string; artist: string } {
  const name = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const parts = name.split(' - ');
  return parts.length > 1
    ? { artist: parts.shift()!.trim(), title: parts.join(' - ').trim() }
    : { title: name || 'Untitled song', artist: '' };
}
