/*
 * Persistencia em IndexedDB (origem da extensao, sobrevive a reciclagem do
 * service worker). Guarda transcricoes, traducoes, dublagens e os clipes de
 * audio em base64.
 */

const DB_NAME = 'udub';
const DB_VERSION = 1;

export const STORE = {
  TRANSCRIPTS: 'transcripts',
  TRANSLATIONS: 'translations',
  DUBS: 'dubs',
  CLIPS: 'clips'
};

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORE)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, run) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const objectStore = transaction.objectStore(store);
        let result;
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        Promise.resolve(run(objectStore)).then((value) => {
          result = value;
        }, reject);
      })
  );
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function get(store, key) {
  return tx(store, 'readonly', (s) => request(s.get(key)));
}

export function put(store, value) {
  return tx(store, 'readwrite', (s) => request(s.put(value)));
}

export function del(store, key) {
  return tx(store, 'readwrite', (s) => request(s.delete(key)));
}

export function getAll(store) {
  return tx(store, 'readonly', (s) => request(s.getAll()));
}

export function clearStore(store) {
  return tx(store, 'readwrite', (s) => request(s.clear()));
}

/** Chave de clipe com indice zero-padded para permitir consulta por faixa. */
export function clipKey(dubId, index) {
  return dubId + '#' + String(index).padStart(6, '0');
}

export function getClip(dubId, index) {
  return get(STORE.CLIPS, clipKey(dubId, index));
}

export function putClip(dubId, index, clip) {
  return put(STORE.CLIPS, Object.assign({ key: clipKey(dubId, index), dubId, index }, clip));
}

/** Clipes de [from, to] em uma unica transacao (usado no prefetch do player). */
export function getClipRange(dubId, from, to) {
  const range = IDBKeyRange.bound(clipKey(dubId, from), clipKey(dubId, to));
  return tx(STORE.CLIPS, 'readonly', (s) => request(s.getAll(range)));
}

/** Indices ja sintetizados, sem carregar o audio (retomada de job). */
export async function getClipIndexes(dubId) {
  const range = IDBKeyRange.bound(clipKey(dubId, 0), clipKey(dubId, 999999));
  const keys = await tx(STORE.CLIPS, 'readonly', (s) => request(s.getAllKeys(range)));
  return new Set(keys.map((key) => Number(String(key).split('#')[1])));
}

export async function deleteDub(dubId) {
  await del(STORE.DUBS, dubId);
  await tx(STORE.CLIPS, 'readwrite', (s) => {
    const range = IDBKeyRange.bound(clipKey(dubId, 0), clipKey(dubId, 999999));
    return request(s.delete(range));
  });
}

export async function estimateUsage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usage, quota };
}
