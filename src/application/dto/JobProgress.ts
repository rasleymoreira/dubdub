/** Evento de progresso de um job, do service worker para o popup e o player. */

import type { JobStatus } from '../../domain/entities/JobStatus.ts';

export interface JobProgress {
  readonly status: JobStatus;
  readonly lectureId?: string;
  readonly key?: string;
  readonly done?: number;
  readonly total?: number;
  readonly failures?: number;
  readonly message?: string;
  readonly notes?: readonly string[];
  /** True quando o progresso vem da fila que adianta as proximas aulas. */
  readonly prefetch?: boolean;
  readonly prefetchTitle?: string;
  readonly prefetchIndex?: number;
  readonly prefetchTotal?: number;
}
