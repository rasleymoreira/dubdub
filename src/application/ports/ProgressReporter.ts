/**
 * Observer do progresso de um job.
 *
 * Antes a funcao `emit` era passada por parametro atraves de quatro niveis de
 * chamada (startJob -> runJob -> buildTranscript -> translateSegments), o que
 * engordava toda assinatura no caminho. Como porta, cada caso de uso recebe um
 * reporter e nao precisa repassar nada.
 */

import type { JobProgress } from '../dto/JobProgress.ts';

export interface ProgressReporter {
  report(progress: JobProgress): void;
}

/** Reporter que adiciona campos fixos a todo evento (usado no prefetch). */
export function withDefaults(
  reporter: ProgressReporter,
  defaults: Partial<JobProgress>
): ProgressReporter {
  return {
    report(progress) {
      reporter.report({ ...defaults, ...progress });
    }
  };
}

export const SILENT_REPORTER: ProgressReporter = {
  report(): void {
    /* nada a fazer */
  }
};
