/*
 * Conexao com o IndexedDB.
 *
 * IndexedDB e a unica opcao aqui: chrome.storage tem teto pequeno demais e o
 * service worker e reciclado a qualquer momento, entao nada pode viver so em
 * memoria. Uma aula de uma hora passa de 100 MB em audio.
 *
 * A versao 2 acrescenta indices na store de dublagens. Sem eles, achar as
 * dublagens de uma aula exigia carregar TODAS as dublagens com todos os
 * segmentos, so para descartar quase tudo.
 */

const DB_NAME = 'udub';
const DB_VERSION = 2;

export const STORE = {
  TRANSCRIPTS: 'transcripts',
  TRANSLATIONS: 'translations',
  DUBS: 'dubs',
  CLIPS: 'clips'
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

export const DUB_INDEX = {
  LECTURE: 'byLecture',
  UPDATED_AT: 'byUpdatedAt'
} as const;

let connection: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase, transaction: IDBTransaction | null): void {
  for (const name of Object.values(STORE)) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'key' });
  }

  // os indices sao novos na v2; a store pode ja existir da v1
  const dubs = transaction?.objectStore(STORE.DUBS) ?? null;
  if (dubs && !dubs.indexNames.contains(DUB_INDEX.LECTURE)) {
    dubs.createIndex(DUB_INDEX.LECTURE, 'lectureId', { unique: false });
  }
  if (dubs && !dubs.indexNames.contains(DUB_INDEX.UPDATED_AT)) {
    dubs.createIndex(DUB_INDEX.UPDATED_AT, 'updatedAt', { unique: false });
  }
}

export function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result, request.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return connection;
}

function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Roda uma operacao dentro de uma transacao e so resolve quando ela COMPLETA.
 *
 * A diferenca importa: o onsuccess de um put dispara antes do commit, entao
 * resolver ali deixaria a escrita passivel de rollback silencioso.
 */
export async function withTransaction<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  const db = await openDatabase();

  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    let result: T;

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);

    Promise.resolve(operation(transaction.objectStore(store))).then((value) => {
      result = value;
    }, reject);
  });
}

export const request = toPromise;

/** Chave de clipe com indice zero-padded, para consulta por faixa funcionar. */
export function clipKey(dubKey: string, index: number): string {
  return `${dubKey}#${String(index).padStart(6, '0')}`;
}

/** Faixa que cobre todos os clipes de uma dublagem. */
export function clipRange(dubKey: string, from = 0, to = 999999): IDBKeyRange {
  return IDBKeyRange.bound(clipKey(dubKey, from), clipKey(dubKey, to));
}
