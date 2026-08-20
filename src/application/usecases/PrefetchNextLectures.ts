/**
 * Adianta a dublagem das proximas aulas do curso.
 *
 * Terminada a aula atual, a extensao le o curriculo, pula o que ja tem dublagem
 * e gera as N seguintes. Quando o usuario avanca, o audio ja esta pronto.
 *
 * Roda dentro do mesmo job da aula atual e compartilha o token de cancelamento,
 * de proposito: clicar em Dublar interrompe a fila e da prioridade ao que a
 * pessoa esta assistindo agora.
 */

import { JobStatus } from '../../domain/entities/JobStatus.ts';
import { CanceledError } from '../../domain/errors/DomainError.ts';
import type { EngineCapabilityMap } from '../../domain/services/EngineCapabilities.ts';
import type { Settings } from '../dto/Settings.ts';
import type { LectureSourcePort } from '../ports/LectureSourcePort.ts';
import type { ProgressReporter } from '../ports/ProgressReporter.ts';
import { withDefaults } from '../ports/ProgressReporter.ts';
import type { Logger } from '../ports/Logger.ts';
import type { CancellationSignal } from '../services/CancellationToken.ts';
import type { DubLecture } from './DubLecture.ts';
import type { FindDubForLecture } from './FindDubForLecture.ts';

export interface PrefetchNextLecturesInput {
  readonly currentLectureId: string;
  readonly settings: Settings;
  readonly reporter: ProgressReporter;
  readonly signal: CancellationSignal;
}

export interface PrefetchNextLecturesDeps {
  readonly source: LectureSourcePort;
  readonly dubLecture: DubLecture;
  readonly findDub: FindDubForLecture;
  readonly capabilities: EngineCapabilityMap;
  readonly logger: Logger;
}

export class PrefetchNextLectures {
  private readonly deps: PrefetchNextLecturesDeps;

  constructor(deps: PrefetchNextLecturesDeps) {
    this.deps = deps;
  }

  async execute(input: PrefetchNextLecturesInput): Promise<number> {
    const wanted = Number(input.settings.prefetchNext) || 0;
    if (wanted <= 0) return 0;

    const items = await this.deps.source.getCurriculum();
    const position = items.findIndex(
      (item) => String(item.lectureId) === String(input.currentLectureId)
    );

    if (position === -1) {
      input.reporter.report({
        status: JobStatus.DONE,
        message: 'Nao consegui ler a lista de aulas do curso'
      });
      return 0;
    }

    let completed = 0;

    for (const item of items.slice(position + 1)) {
      if (completed >= wanted) break;
      input.signal.throwIfCanceled();

      const existing = await this.deps.findDub.execute(item.lectureId, input.settings);
      if (existing && existing.total > 0 && existing.ready >= existing.total) continue;

      const lecture = await this.deps.source.getLectureContext(item.lectureId);
      if (!lecture) continue;

      const label = item.title || 'Aula ' + item.lectureId;
      const reporter = withDefaults(input.reporter, {
        lectureId: item.lectureId,
        prefetch: true,
        prefetchTitle: label,
        prefetchIndex: completed + 1,
        prefetchTotal: wanted
      });

      try {
        await this.deps.dubLecture.execute({
          lecture: { ...lecture, title: lecture.title || item.title },
          settings: input.settings,
          startAt: 0,
          force: false,
          reporter,
          signal: input.signal
        });
        completed++;
      } catch (error) {
        if (error instanceof CanceledError) throw error;
        this.deps.logger.warn('pre-dublagem falhou em ' + label, error);
        reporter.report({
          status: JobStatus.ERROR,
          message: 'Falhou em ' + label + ': ' + describe(error)
        });
      }
    }

    return completed;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
