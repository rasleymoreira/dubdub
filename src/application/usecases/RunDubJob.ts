/**
 * Ciclo de vida completo de um job disparado pelo usuario.
 *
 * Sequencia: dublar a aula aberta, avisar o player que ha manifesto novo,
 * adiantar as proximas. O cancelamento atravessa as tres etapas pelo mesmo
 * token, entao parar no meio do adiantamento tambem funciona.
 *
 * Erros de cancelamento viram estado CANCELED e nao erro: o usuario pediu.
 */

import { JobStatus } from '../../domain/entities/JobStatus.ts';
import { CanceledError } from '../../domain/errors/DomainError.ts';
import type { DubManifest } from '../dto/DubManifest.ts';
import type { JobProgress } from '../dto/JobProgress.ts';
import type { Settings } from '../dto/Settings.ts';
import type { Lecture } from '../../domain/entities/Lecture.ts';
import type { ProgressReporter } from '../ports/ProgressReporter.ts';
import type { Logger } from '../ports/Logger.ts';
import type { Clock } from '../ports/Clock.ts';
import type { JobManager } from '../services/JobManager.ts';
import type { DubLecture } from './DubLecture.ts';
import type { PrefetchNextLectures } from './PrefetchNextLectures.ts';
import type { GetDubManifest } from './FindDubForLecture.ts';

export interface RunDubJobInput {
  readonly tabId: number;
  readonly lecture: Lecture;
  readonly settings: Settings;
  readonly startAt: number;
  readonly force: boolean;
  /** Pedido do usuario (tem prioridade) ou disparo automatico. */
  readonly manual: boolean;
}

export interface RunDubJobDeps {
  readonly jobs: JobManager;
  readonly dubLecture: DubLecture;
  readonly prefetch: PrefetchNextLectures;
  readonly getManifest: GetDubManifest;
  readonly logger: Logger;
  readonly clock: Clock;
  /** Publica o progresso para o popup e para a aba. */
  readonly publishProgress: (tabId: number, progress: JobProgress) => void;
  /** Entrega o manifesto pronto ao player da aba. */
  readonly publishManifest: (tabId: number, manifest: DubManifest, autoEnable: boolean) => void;
}

export class RunDubJob {
  private readonly deps: RunDubJobDeps;

  constructor(deps: RunDubJobDeps) {
    this.deps = deps;
  }

  /** Registra o job e devolve assim que ele comeca: o progresso vem por evento. */
  async start(input: RunDubJobInput): Promise<void> {
    await this.deps.jobs.claim(input.tabId, input.manual);

    const handle = this.deps.jobs.register(
      input.tabId,
      input.lecture.lectureId,
      this.deps.clock.now()
    );

    const reporter: ProgressReporter = {
      report: (progress) => {
        const enriched = { lectureId: input.lecture.lectureId, ...progress };
        this.deps.jobs.recordProgress(input.tabId, enriched);
        this.deps.publishProgress(input.tabId, enriched);
      }
    };

    handle.promise = this.run(input, reporter).finally(() => this.deps.jobs.finish(input.tabId));
  }

  private async run(input: RunDubJobInput, reporter: ProgressReporter): Promise<void> {
    const handle = this.deps.jobs.get(input.tabId);
    if (!handle) return;

    try {
      const dub = await this.deps.dubLecture.execute({
        lecture: input.lecture,
        settings: input.settings,
        startAt: input.startAt,
        force: input.force,
        reporter,
        signal: handle.token
      });

      const manifest = await this.deps.getManifest.execute(dub.key);
      if (manifest) {
        this.deps.publishManifest(input.tabId, manifest, input.settings.autoEnable);
      }

      handle.prefetching = true;
      await this.deps.prefetch.execute({
        currentLectureId: input.lecture.lectureId,
        settings: input.settings,
        reporter,
        signal: handle.token
      });

      reporter.report({
        status: JobStatus.DONE,
        done: dub.ready,
        total: dub.total
      });
    } catch (error) {
      if (error instanceof CanceledError) {
        reporter.report({ status: JobStatus.CANCELED, message: 'Dublagem cancelada' });
        return;
      }
      this.deps.logger.error('job falhou', error);
      reporter.report({
        status: JobStatus.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
