/*
 * Cache de audio do lado do player (Proxy de carregamento tardio).
 *
 * O manifesto traz os tempos e os textos, mas nao o audio: uma aula de uma hora
 * passa de 100 MB e nao caberia numa mensagem. Os clipes vem sob demanda, em
 * lotes, conforme o video avanca.
 *
 * Tres estados por indice, e a distincao importa: carregado, carregando e
 * ausente. "Ausente" quer dizer que o service worker respondeu e nao havia
 * audio ainda (o job continua rodando), entao pedir de novo a cada 100 ms so
 * geraria trafego. A marca e limpa quando o job avisa que gerou mais.
 *
 * As URLs sao blobs e precisam de revoke explicito: sem isso a aba acumula
 * memoria ate travar em aulas longas.
 */

import type { StoredClip } from '../../../application/ports/repositories.ts';
import type { Logger } from '../../../application/ports/Logger.ts';

const BATCH_SIZE = 8;
const PREFETCH_AHEAD = 10;
const KEEP_BEHIND = 15;
const KEEP_AHEAD = 60;
const PROBE_TIMEOUT_MS = 6000;

export interface LoadedPart {
  readonly url: string;
  readonly duration: number;
}

export interface LoadedClip {
  readonly parts: readonly LoadedPart[];
  /** Soma das partes: a duracao real do trecho falado. */
  readonly total: number;
}

export type ClipFetcher = (key: string, from: number, count: number) => Promise<StoredClip[]>;

/**
 * Avisado antes de revogar uma URL de blob, para que o pool solte o slot que a
 * estiver segurando. Sem isso o slot fica apontando para uma URL morta e a
 * proxima reproducao daquele elemento falha silenciosamente.
 */
export type UrlReleaseListener = (url: string) => void;

export class ClipCache {
  readonly #clips = new Map<number, LoadedClip>();
  readonly #loading = new Set<number>();
  readonly #absent = new Set<number>();
  readonly #fetch: ClipFetcher;
  readonly #logger: Logger;
  readonly #onRelease: UrlReleaseListener;
  #dubKey: string | null = null;

  constructor(fetcher: ClipFetcher, logger: Logger, onRelease: UrlReleaseListener) {
    this.#fetch = fetcher;
    this.#logger = logger;
    this.#onRelease = onRelease;
  }

  get(index: number): LoadedClip | undefined {
    return this.#clips.get(index);
  }

  /** Troca de dublagem: o que estava carregado nao serve mais. */
  reset(dubKey: string | null): void {
    if (dubKey === this.#dubKey) {
      this.#absent.clear();
      return;
    }
    this.#dubKey = dubKey;
    for (const clip of this.#clips.values()) this.#revoke(clip);
    this.#clips.clear();
    this.#loading.clear();
    this.#absent.clear();
  }

  /** O job gerou mais trechos: vale tentar de novo os que faltavam. */
  markStale(): void {
    this.#absent.clear();
  }

  /** Carrega um lote a frente. Um por tick, para nao disputar com a reproducao. */
  prefetch(startIndex: number, totalSegments: number): void {
    const from = Math.max(0, startIndex);
    const to = Math.min(totalSegments, from + PREFETCH_AHEAD);

    for (let index = from; index < to; index++) {
      if (this.#clips.has(index) || this.#loading.has(index) || this.#absent.has(index)) continue;
      void this.#load(index, totalSegments);
      return;
    }
  }

  /** Descarta o que ficou longe do ponto atual, nos dois sentidos. */
  evict(currentIndex: number): void {
    if (this.#clips.size < KEEP_BEHIND + KEEP_AHEAD + 10) return;

    for (const [index, clip] of this.#clips) {
      if (index < currentIndex - KEEP_BEHIND || index > currentIndex + KEEP_AHEAD) {
        this.#revoke(clip);
        this.#clips.delete(index);
      }
    }
  }

  destroy(): void {
    for (const clip of this.#clips.values()) this.#revoke(clip);
    this.#clips.clear();
  }

  async #load(index: number, totalSegments: number): Promise<void> {
    const key = this.#dubKey;
    if (!key) return;

    const from = index;
    const to = Math.min(totalSegments, from + BATCH_SIZE);
    for (let i = from; i < to; i++) this.#loading.add(i);

    try {
      const rows = await this.#fetch(key, from, to - from);
      const received = new Set<number>();

      for (const row of rows) {
        const clip = await this.#decode(row);
        if (clip) {
          this.#clips.set(row.index, clip);
          received.add(row.index);
        }
      }

      // o que o worker nao devolveu ainda nao existe: nao insistir a cada tick
      for (let i = from; i < to; i++) {
        if (!received.has(i)) this.#absent.add(i);
      }
    } catch (error) {
      this.#logger.warn('falha ao buscar clipes', error);
    } finally {
      for (let i = from; i < to; i++) this.#loading.delete(i);
    }
  }

  async #decode(row: StoredClip): Promise<LoadedClip | null> {
    const parts: LoadedPart[] = [];
    let total = 0;

    for (const encoded of row.parts) {
      const url = URL.createObjectURL(base64ToBlob(encoded, row.mime));
      const duration = await probeDuration(url);

      // duracao zero significa audio corrompido: descartar em vez de tocar mudo
      if (!duration) {
        URL.revokeObjectURL(url);
        continue;
      }

      parts.push({ url, duration });
      total += duration;
    }

    return parts.length > 0 ? { parts, total } : null;
  }

  #revoke(clip: LoadedClip): void {
    for (const part of clip.parts) {
      // a ordem importa: soltar o slot antes de invalidar a URL
      this.#onRelease(part.url);
      URL.revokeObjectURL(part.url);
    }
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime || 'audio/mpeg' });
}

/**
 * Duracao real do clipe, medida pelo decodificador do navegador.
 *
 * Nao da para derivar do texto nem confiar no que o provedor diz: cada motor
 * fala em ritmo proprio, e e essa duracao que decide se a fala precisa ser
 * comprimida para caber no tempo do video.
 */
function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = 'metadata';
    let settled = false;

    const finish = (value: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.onloadedmetadata = null;
      probe.onerror = null;
      probe.removeAttribute('src');
      resolve(value);
    };

    const timer = setTimeout(() => finish(0), PROBE_TIMEOUT_MS);
    probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => finish(0);
    probe.src = url;
  });
}
