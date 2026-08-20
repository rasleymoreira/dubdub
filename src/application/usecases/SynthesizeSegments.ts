/**
 * Gera o audio de cada trecho e guarda no cache.
 *
 * A falha de um trecho nao derruba o job: uma aula com 3 trechos sem audio ainda
 * e util, e clicar em Redublar refaz so o que faltou. O que NAO pode ser
 * engolido e o cancelamento, que precisa propagar imediatamente.
 */

import { JobStatus } from '../../domain/entities/JobStatus.ts';
import type { Dub } from '../../domain/entities/Dub.ts';
import { CanceledError } from '../../domain/errors/DomainError.ts';
import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import type { TtsEngineId, VoiceId } from '../../domain/value-objects/EngineId.ts';
import type { ClipRepository, DubRepository } from '../ports/repositories.ts';
import type { ProgressReporter } from '../ports/ProgressReporter.ts';
import type { Logger } from '../ports/Logger.ts';
import type { Clock } from '../ports/Clock.ts';
import type { CancellationSignal } from '../services/CancellationToken.ts';
import type { TtsRegistry } from '../services/TtsRegistry.ts';
import { mapLimit } from '../services/mapLimit.ts';

/** Gravar o progresso a cada trecho seria uma escrita por segundo, sem ganho. */
const PROGRESS_FLUSH_EVERY = 8;

export interface SynthesizeSegmentsInput {
  readonly dub: Dub;
  /** Indices na ordem em que devem ser gerados. */
  readonly order: readonly number[];
  readonly engine: TtsEngineId;
  readonly voice: VoiceId | null;
  readonly targetLang: LanguageTag;
  /** Indices que ja tem audio, para o contador comecar certo. */
  readonly alreadyDone: ReadonlySet<number>;
  readonly signal: CancellationSignal;
  readonly reporter: ProgressReporter;
}

export interface SynthesizeSegmentsOutput {
  readonly ready: number;
  readonly failures: number;
}

export interface SynthesizeSegmentsDeps {
  readonly registry: TtsRegistry;
  readonly clips: ClipRepository;
  readonly dubs: DubRepository;
  readonly logger: Logger;
  readonly clock: Clock;
}

export class SynthesizeSegments {
  private readonly deps: SynthesizeSegmentsDeps;

  constructor(deps: SynthesizeSegmentsDeps) {
    this.deps = deps;
  }

  async execute(input: SynthesizeSegmentsInput): Promise<SynthesizeSegmentsOutput> {
    const synthesizer = this.deps.registry.get(input.engine);
    const done = new Set(input.alreadyDone);
    const total = input.dub.segments.length;

    let failures = 0;
    let sinceFlush = 0;

    await mapLimit(
      input.order,
      synthesizer.concurrency,
      async (index) => {
        input.signal.throwIfCanceled();
        const segment = input.dub.segments[index];
        if (!segment) return;

        try {
          const clip = await synthesizer.speak({
            text: segment.targetText,
            voice: input.voice,
            targetLang: input.targetLang,
            signal: input.signal
          });
          await this.deps.clips.save(input.dub.key, index, clip, segment.start, segment.end);
          done.add(index);
        } catch (error) {
          if (error instanceof CanceledError) throw error;
          failures++;
          this.deps.logger.warn(`falha ao sintetizar o trecho ${index}`, error);
        }

        if (++sinceFlush >= PROGRESS_FLUSH_EVERY) {
          sinceFlush = 0;
          await this.deps.dubs.save({
            ...input.dub,
            ready: done.size,
            updatedAt: this.deps.clock.now()
          });
        }

        input.reporter.report({
          status: JobStatus.SYNTHESIZING,
          done: done.size,
          total,
          failures,
          message: 'Gerando a voz'
        });
      },
      input.signal
    );

    return { ready: done.size, failures };
  }
}
