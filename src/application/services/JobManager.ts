/**
 * Registro dos jobs em andamento, um por aba.
 *
 * Antes isso eram tres Maps soltos no service worker (jobs, tabLectures,
 * lastProgress) manipulados de dentro dos handlers de mensagem. Concentrar aqui
 * deixa uma regra sutil explicita e testavel: um Dublar manual tem prioridade
 * sobre a fila de adiantamento, entao ele cancela o prefetch em andamento e
 * assume a aba; mas nao interrompe outro job manual.
 */

import type { JobProgress } from '../dto/JobProgress.ts';
import { CancellationToken } from './CancellationToken.ts';

export interface JobHandle {
  readonly tabId: number;
  readonly lectureId: string;
  readonly token: CancellationToken;
  readonly startedAt: number;
  /** True depois que a aula pedida terminou e a fila de adiantamento comecou. */
  prefetching: boolean;
  promise: Promise<void>;
}

export class JobAlreadyRunningError extends Error {
  override readonly name = 'JobAlreadyRunningError';

  constructor() {
    super('Ja existe uma dublagem em andamento nesta aba.');
  }
}

export class JobManager {
  readonly #jobs = new Map<number, JobHandle>();
  readonly #lastProgress = new Map<number, JobProgress>();

  isRunning(tabId: number): boolean {
    return this.#jobs.has(tabId);
  }

  get(tabId: number): JobHandle | undefined {
    return this.#jobs.get(tabId);
  }

  lastProgress(tabId: number): JobProgress | null {
    return this.#lastProgress.get(tabId) ?? null;
  }

  recordProgress(tabId: number, progress: JobProgress): void {
    this.#lastProgress.set(tabId, progress);
  }

  /**
   * Libera a aba para um job novo. Um pedido manual desbanca uma fila de
   * adiantamento em andamento; qualquer outra combinacao e recusada.
   */
  async claim(tabId: number, manual: boolean): Promise<void> {
    const existing = this.#jobs.get(tabId);
    if (!existing) return;

    if (!manual || !existing.prefetching) throw new JobAlreadyRunningError();

    existing.token.cancel();
    await existing.promise.catch(() => undefined);
  }

  register(tabId: number, lectureId: string, startedAt: number): JobHandle {
    const handle: JobHandle = {
      tabId,
      lectureId,
      token: new CancellationToken(),
      startedAt,
      prefetching: false,
      promise: Promise.resolve()
    };
    this.#jobs.set(tabId, handle);
    return handle;
  }

  cancel(tabId: number): boolean {
    const job = this.#jobs.get(tabId);
    if (!job) return false;
    job.token.cancel();
    return true;
  }

  finish(tabId: number): void {
    this.#jobs.delete(tabId);
  }

  /** A aba foi fechada: cancela o que estiver rodando e esquece o estado dela. */
  forget(tabId: number): void {
    this.cancel(tabId);
    this.#jobs.delete(tabId);
    this.#lastProgress.delete(tabId);
  }
}
