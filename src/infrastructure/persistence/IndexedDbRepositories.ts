/*
 * Implementacoes IndexedDB dos repositorios.
 *
 * Todo o conhecimento de store, formato de chave e serializacao mora aqui. O
 * caso de uso pede "as dublagens desta aula" e nao sabe que existe um indice.
 */

import type { Dub } from '../../domain/entities/Dub.ts';
import type { AudioClip } from '../../domain/entities/AudioClip.ts';
import type { Transcript } from '../../domain/entities/Transcript.ts';
import type { DubSummary } from '../../application/dto/DubManifest.ts';
import type {
  CacheMaintenancePort,
  ClipRepository,
  DubRepository,
  StorageEstimate,
  StoredClip,
  TranscriptRepository,
  TranslationRepository
} from '../../application/ports/repositories.ts';
import {
  DUB_INDEX,
  STORE,
  clipKey,
  clipRange,
  openDatabase,
  request,
  withTransaction
} from './IndexedDbConnection.ts';
import {
  fromDubRecord,
  fromTranscriptRecord,
  toDubRecord,
  toTranscriptRecord,
  type ClipRecord,
  type DubRecord,
  type TranscriptRecord,
  type TranslationRecord
} from './records.ts';

export class IndexedDbDubRepository implements DubRepository {
  async find(key: string): Promise<Dub | null> {
    const record = await withTransaction(STORE.DUBS, 'readonly', (store) =>
      request<DubRecord | undefined>(store.get(key) as IDBRequest<DubRecord | undefined>)
    );
    return record ? fromDubRecord(record) : null;
  }

  async save(dub: Dub): Promise<void> {
    await withTransaction(STORE.DUBS, 'readwrite', (store) => request(store.put(toDubRecord(dub))));
  }

  /** Apaga a dublagem e o audio dela: orfaos de clipe encheriam o disco. */
  async delete(key: string): Promise<void> {
    await withTransaction(STORE.DUBS, 'readwrite', (store) => request(store.delete(key)));
    await withTransaction(STORE.CLIPS, 'readwrite', (store) =>
      request(store.delete(clipRange(key)))
    );
  }

  /**
   * Le pelo indice de aula, o que evita percorrer o cache inteiro. A versao
   * anterior fazia getAll() de todas as dublagens, trazendo os segmentos de
   * cada uma, para depois filtrar por lectureId em memoria.
   */
  async findByLecture(lectureId: string): Promise<Dub[]> {
    const records = await withTransaction(STORE.DUBS, 'readonly', (store) =>
      request<DubRecord[]>(
        store.index(DUB_INDEX.LECTURE).getAll(String(lectureId)) as IDBRequest<DubRecord[]>
      )
    );
    return records.map(fromDubRecord);
  }

  async listSummaries(): Promise<DubSummary[]> {
    const records = await withTransaction(STORE.DUBS, 'readonly', (store) =>
      request<DubRecord[]>(store.getAll() as IDBRequest<DubRecord[]>)
    );

    return records
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((record) => ({
        key: record.key,
        title: record.title,
        lectureId: String(record.lectureId),
        targetLang: record.targetLang,
        ttsEngine: record.ttsEngine,
        ready: record.ready,
        total: record.total,
        status: record.status,
        updatedAt: record.updatedAt
      }));
  }

  /** Descarta as mais antigas por data de atualizacao (LRU). */
  async evictOldest(keep: number): Promise<string[]> {
    const summaries = await this.listSummaries();
    if (summaries.length <= keep) return [];

    const excess = summaries.slice(keep);
    for (const summary of excess) await this.delete(summary.key);
    return excess.map((summary) => summary.key);
  }
}

export class IndexedDbClipRepository implements ClipRepository {
  async save(
    dubKey: string,
    index: number,
    clip: AudioClip,
    start: number,
    end: number
  ): Promise<void> {
    const record: ClipRecord = {
      key: clipKey(dubKey, index),
      dubId: dubKey,
      index,
      parts: clip.parts,
      mime: clip.mime,
      start,
      end
    };
    await withTransaction(STORE.CLIPS, 'readwrite', (store) => request(store.put(record)));
  }

  async range(dubKey: string, from: number, to: number): Promise<StoredClip[]> {
    const records = await withTransaction(STORE.CLIPS, 'readonly', (store) =>
      request<ClipRecord[]>(store.getAll(clipRange(dubKey, from, to)) as IDBRequest<ClipRecord[]>)
    );

    return records.map((record) => ({
      index: record.index,
      parts: record.parts,
      mime: record.mime,
      start: record.start,
      end: record.end
    }));
  }

  /**
   * So as chaves, sem o audio. E o que permite Redublar retomar de onde parou
   * sem carregar centenas de megabytes para descobrir o que ja existe.
   */
  async synthesizedIndexes(dubKey: string): Promise<Set<number>> {
    const keys = await withTransaction(STORE.CLIPS, 'readonly', (store) =>
      request<IDBValidKey[]>(store.getAllKeys(clipRange(dubKey)))
    );

    return new Set(
      keys
        .map((key) => Number(String(key).split('#')[1]))
        .filter((index) => Number.isInteger(index))
    );
  }
}

export class IndexedDbTranscriptRepository implements TranscriptRepository {
  async find(key: string): Promise<Transcript | null> {
    const record = await withTransaction(STORE.TRANSCRIPTS, 'readonly', (store) =>
      request<TranscriptRecord | undefined>(
        store.get(key) as IDBRequest<TranscriptRecord | undefined>
      )
    );
    return record ? fromTranscriptRecord(record) : null;
  }

  async save(key: string, transcript: Transcript): Promise<void> {
    await withTransaction(STORE.TRANSCRIPTS, 'readwrite', (store) =>
      request(store.put(toTranscriptRecord(key, transcript)))
    );
  }
}

export class IndexedDbTranslationRepository implements TranslationRepository {
  /** Busca em lote numa transacao so: uma aula tem centenas de trechos. */
  async findMany(keys: readonly string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];

    return withTransaction(STORE.TRANSLATIONS, 'readonly', async (store) => {
      const records = await Promise.all(
        keys.map((key) =>
          request<TranslationRecord | undefined>(
            store.get(key) as IDBRequest<TranslationRecord | undefined>
          )
        )
      );
      return records.map((record) => record?.text ?? null);
    });
  }

  async saveMany(entries: readonly { key: string; text: string }[]): Promise<void> {
    if (entries.length === 0) return;

    await withTransaction(STORE.TRANSLATIONS, 'readwrite', async (store) => {
      const now = Date.now();
      await Promise.all(
        entries.map((entry) =>
          request(store.put({ ...entry, createdAt: now } as TranslationRecord))
        )
      );
    });
  }
}

export class IndexedDbCacheMaintenance implements CacheMaintenancePort {
  async estimate(): Promise<StorageEstimate | null> {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage: usage ?? 0, quota: quota ?? 0 };
  }

  async clearAll(): Promise<void> {
    await openDatabase();
    for (const store of Object.values(STORE)) {
      await withTransaction(store, 'readwrite', (objectStore) => request(objectStore.clear()));
    }
  }
}
