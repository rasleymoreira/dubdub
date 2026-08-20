/**
 * Mantem o cache dentro do limite de aulas configurado.
 *
 * Uma aula de uma hora ocupa mais de 100 MB nos motores locais, que devolvem
 * WAV. Sem teto o disco enche em uma semana de curso, entao as dublagens mais
 * antigas saem primeiro (LRU por data de atualizacao).
 */

import type { DubRepository } from '../ports/repositories.ts';
import type { Logger } from '../ports/Logger.ts';

export interface EnforceCacheLimitDeps {
  readonly dubs: DubRepository;
  readonly logger: Logger;
}

export class EnforceCacheLimit {
  private readonly deps: EnforceCacheLimitDeps;

  constructor(deps: EnforceCacheLimitDeps) {
    this.deps = deps;
  }

  /** Devolve as chaves descartadas. Limite zero ou negativo desliga o corte. */
  async execute(maxDubs: number): Promise<string[]> {
    const limit = Number(maxDubs) || 0;
    if (limit <= 0) return [];

    const removed = await this.deps.dubs.evictOldest(limit);
    if (removed.length > 0) {
      this.deps.logger.info(`cache: ${removed.length} dublagem(ns) antiga(s) descartada(s)`);
    }
    return removed;
  }
}
