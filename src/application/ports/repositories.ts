/**
 * Repositorios (padrao Repository).
 *
 * Antes o pipeline manipulava o IndexedDB direto, escrevendo coisas como
 * `db.get(db.STORE.TRANSCRIPTS, chave)` no meio da regra de negocio. Isso e
 * Inappropriate Intimacy: a orquestracao conhecia nome de store, formato de
 * chave e ate a serializacao. Agora fala em termos de dominio.
 */

import type { Dub } from '../../domain/entities/Dub.ts';
import type { Transcript } from '../../domain/entities/Transcript.ts';
import type { AudioClip } from '../../domain/entities/AudioClip.ts';
import type { DubSummary } from '../dto/DubManifest.ts';
import type { Settings, SettingsPatch } from '../dto/Settings.ts';

export interface DubRepository {
  find(key: string): Promise<Dub | null>;
  save(dub: Dub): Promise<void>;
  /** Apaga a dublagem e todos os clipes dela. */
  delete(key: string): Promise<void>;
  /** Resumos ordenados do mais recente para o mais antigo, sem os segmentos. */
  listSummaries(): Promise<DubSummary[]>;
  /**
   * Dublagens de uma aula, em qualquer motor ou idioma. Usa indice por
   * lectureId: a versao anterior carregava TODAS as dublagens com todos os
   * segmentos so para achar uma.
   */
  findByLecture(lectureId: string): Promise<Dub[]>;
  /** Descarta as mais antigas, mantendo no maximo `keep`. Devolve o que saiu. */
  evictOldest(keep: number): Promise<string[]>;
}

/** Clipe guardado, com os tempos para o player nao precisar do manifesto. */
export interface StoredClip extends AudioClip {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

export interface ClipRepository {
  save(dubKey: string, index: number, clip: AudioClip, start: number, end: number): Promise<void>;
  /** Faixa [from, to] em uma unica transacao, usada no prefetch do player. */
  range(dubKey: string, from: number, to: number): Promise<StoredClip[]>;
  /** Indices ja sintetizados, sem carregar audio: e assim que Redublar retoma. */
  synthesizedIndexes(dubKey: string): Promise<Set<number>>;
}

export interface TranscriptRepository {
  find(key: string): Promise<Transcript | null>;
  save(key: string, transcript: Transcript): Promise<void>;
}

export interface TranslationRepository {
  /** Busca em lote; posicoes sem cache vem como null. */
  findMany(keys: readonly string[]): Promise<(string | null)[]>;
  saveMany(entries: readonly { key: string; text: string }[]): Promise<void>;
}

export interface SettingsRepository {
  load(): Promise<Settings>;
  save(patch: SettingsPatch): Promise<Settings>;
}

export interface StorageEstimate {
  readonly usage: number;
  readonly quota: number;
}

export interface CacheMaintenancePort {
  estimate(): Promise<StorageEstimate | null>;
  clearAll(): Promise<void>;
}
