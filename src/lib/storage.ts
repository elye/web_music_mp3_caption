import { DEFAULT_PREFERENCES, type Preferences, type Track } from '../types';

let dbPromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('chorus-library', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('tracks', { keyPath: 'id' });
        request.result.createObjectStore('meta');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Chorus tabs and reload to open local storage.'));
    });
    dbPromise.catch(() => { dbPromise = undefined; });
  }
  return dbPromise;
}

export async function loadTracks(): Promise<Track[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tracks', 'meta'], 'readonly');
    const tracks = tx.objectStore('tracks').getAll();
    const order = tx.objectStore('meta').get('order');
    tx.oncomplete = () => {
      const positions = new Map<string, number>((order.result ?? []).map((id: string, index: number) => [id, index]));
      resolve((tracks.result as Track[]).sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity)));
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function storeTrack(track: Track): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').put(track);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function removeStoredTrack(id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function storeOrder(ids: string[]): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(ids, 'order');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const clamp = (n: unknown, min: number, max: number, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
export function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('chorus-preferences') ?? '{}');
    return {
      volume: clamp(value.volume, 0, 1, DEFAULT_PREFERENCES.volume),
      fontSize: clamp(value.fontSize, 32, 88, DEFAULT_PREFERENCES.fontSize),
      gap: [0, 3, 5, 10].includes(value.gap) ? value.gap : DEFAULT_PREFERENCES.gap,
      fade: [0.6, 1.2, 2.5].includes(value.fade) ? value.fade : DEFAULT_PREFERENCES.fade,
      repeat: value.repeat === true,
      repeatMode: value.repeatMode === 'song' ? 'song' : 'queue',
      highContrast: value.highContrast === true,
      minusOne: value.minusOne === true,
    };
  } catch { return DEFAULT_PREFERENCES; }
}

export function storePreferences(preferences: Preferences) {
  localStorage.setItem('chorus-preferences', JSON.stringify(preferences));
}
