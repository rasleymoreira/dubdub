/** Casos de uso da tela de cache do popup: listar, apagar uma, apagar tudo. */

import type { DubManifest, DubSummary } from '../dto/DubManifest.ts';
import type {
  CacheMaintenancePort,
  ClipRepository,
  DubRepository,
  StorageEstimate,
  StoredClip
} from '../ports/repositories.ts';

export interface CacheListing {
  readonly dubs: readonly DubSummary[];
  readonly usage: StorageEstimate | null;
}

export class ListDubs {
  private readonly dubs: DubRepository;
  private readonly maintenance: CacheMaintenancePort;

  constructor(dubs: DubRepository, maintenance: CacheMaintenancePort) {
    this.dubs = dubs;
    this.maintenance = maintenance;
  }

  async execute(): Promise<CacheListing> {
    const [dubs, usage] = await Promise.all([
      this.dubs.listSummaries(),
      this.maintenance.estimate()
    ]);
    return { dubs, usage };
  }
}

export class DeleteDub {
  private readonly dubs: DubRepository;

  constructor(dubs: DubRepository) {
    this.dubs = dubs;
  }

  execute(key: string): Promise<void> {
    return this.dubs.delete(key);
  }
}

export class ClearCache {
  private readonly maintenance: CacheMaintenancePort;

  constructor(maintenance: CacheMaintenancePort) {
    this.maintenance = maintenance;
  }

  execute(): Promise<void> {
    return this.maintenance.clearAll();
  }
}

/**
 * Entrega ao player os clipes de uma faixa de trechos.
 *
 * Vem por faixa e nao um a um porque cada mensagem entre service worker e
 * content script custa uma serializacao: pedir oito de uma vez e o que faz o
 * player nao engasgar ao dar seek.
 */
export class GetClips {
  private readonly clips: ClipRepository;

  constructor(clips: ClipRepository) {
    this.clips = clips;
  }

  execute(dubKey: string, from: number, count: number): Promise<StoredClip[]> {
    const start = Math.max(0, from);
    const end = start + Math.max(1, count) - 1;
    return this.clips.range(dubKey, start, end);
  }
}

export type { DubManifest };
