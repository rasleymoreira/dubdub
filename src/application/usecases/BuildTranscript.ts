/**
 * Obtem o texto original da aula, com cache e degradacao em cadeia.
 *
 * A fonte escolhida vai primeiro; depois vem as gratuitas. A cadeia nunca sobe
 * de volta para a fonte paga: se o usuario pediu legendas, o Deepgram nao entra
 * sozinho e gera custo que ninguem pediu.
 */

import type { Lecture } from '../../domain/entities/Lecture.ts';
import type { SourceSegment } from '../../domain/entities/Segment.ts';
import type { TranscriptOrigin } from '../../domain/entities/Transcript.ts';
import { describeOrigin } from '../../domain/entities/Transcript.ts';
import { JobStatus } from '../../domain/entities/JobStatus.ts';
import { TranscriptKey } from '../../domain/value-objects/DubKey.ts';
import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import type { SttProviderId } from '../../domain/value-objects/EngineId.ts';
import { NoTranscriptSourceError } from '../../domain/errors/DomainError.ts';
import { normalizeForSpeech } from '../../domain/services/SpeechTextPolisher.ts';
import type { TranscriptionPort } from '../ports/TranscriptionPort.ts';
import type { TranscriptRepository } from '../ports/repositories.ts';
import type { ProgressReporter } from '../ports/ProgressReporter.ts';
import type { Clock } from '../ports/Clock.ts';
import type { CancellationSignal } from '../services/CancellationToken.ts';

export interface BuildTranscriptInput {
  readonly lecture: Lecture;
  readonly sourceLang: LanguageTag;
  readonly sttProvider: SttProviderId;
  readonly signal: CancellationSignal;
  /**
   * Vem por chamada e nao pelo construtor: o reporter e diferente para a aula
   * atual e para cada aula da fila de adiantamento, que precisa carimbar o
   * evento com o titulo e a posicao na fila.
   */
  readonly reporter: ProgressReporter;
}

export interface BuildTranscriptOutput {
  readonly segments: readonly SourceSegment[];
  readonly origin: TranscriptOrigin;
  readonly notes: readonly string[];
  readonly fromCache: boolean;
}

export interface BuildTranscriptDeps {
  readonly sources: readonly TranscriptionPort[];
  readonly transcripts: TranscriptRepository;
  readonly clock: Clock;
}

/**
 * A normalizacao roda tambem sobre o que veio do cache. Assim transcricoes
 * antigas se beneficiam de melhorias no tratamento de texto sem precisar
 * transcrever de novo, que e a parte cara.
 */
function normalize(segments: readonly SourceSegment[]): SourceSegment[] {
  return segments
    .map((segment) => ({ ...segment, text: normalizeForSpeech(segment.text, { dedupe: true }) }))
    .filter((segment) => segment.text.length > 0);
}

export class BuildTranscript {
  private readonly deps: BuildTranscriptDeps;

  constructor(deps: BuildTranscriptDeps) {
    this.deps = deps;
  }

  async execute(input: BuildTranscriptInput): Promise<BuildTranscriptOutput> {
    const key = TranscriptKey.from({
      lectureId: input.lecture.lectureId,
      sttProvider: input.sttProvider,
      sourceLang: input.sourceLang
    }).toString();

    const cached = await this.deps.transcripts.find(key);
    if (cached && cached.segments.length > 0) {
      return {
        segments: normalize(cached.segments),
        origin: cached.origin,
        notes: [],
        fromCache: true
      };
    }

    input.reporter.report({
      status: JobStatus.TRANSCRIBING,
      message: 'Obtendo o texto original'
    });

    const result = await this.runChain(input);
    if (!result) throw new NoTranscriptSourceError(input.lecture.lectureId);

    await this.deps.transcripts.save(key, {
      lectureId: input.lecture.lectureId,
      segments: result.segments,
      origin: result.origin,
      createdAt: this.deps.clock.now()
    });

    return {
      segments: normalize(result.segments),
      origin: result.origin,
      notes: result.notes,
      fromCache: false
    };
  }

  /** Fonte escolhida primeiro, depois as gratuitas. Nunca o contrario. */
  private chainFor(sttProvider: SttProviderId): readonly TranscriptionPort[] {
    const primary = this.deps.sources.find((source) => source.id === sttProvider);
    const free = this.deps.sources.filter(
      (source) => source !== primary && source.id !== 'deepgram'
    );
    return primary ? [primary, ...free] : free;
  }

  private async runChain(
    input: BuildTranscriptInput
  ): Promise<{
    segments: readonly SourceSegment[];
    origin: TranscriptOrigin;
    notes: string[];
  } | null> {
    const notes: string[] = [];

    for (const source of this.chainFor(input.sttProvider)) {
      input.signal.throwIfCanceled();

      input.reporter.report({
        status: JobStatus.TRANSCRIBING,
        message: source.label
      });

      const result = await source.transcribe({
        lecture: input.lecture,
        sourceLang: input.sourceLang,
        signal: input.signal
      });

      notes.push(...(result?.notes ?? []));
      if (result && result.segments.length > 0) {
        return { segments: result.segments, origin: result.origin, notes };
      }
    }

    return null;
  }
}

export { describeOrigin };
