/**
 * Dubla uma aula, do texto original ao audio no cache.
 *
 * Este e o caso de uso central e deliberadamente magro: ele decide a ORDEM das
 * etapas e nada mais. Transcrever, traduzir e sintetizar sao casos de uso
 * proprios; qual servico atende cada um e problema do registry. A versao
 * anterior era uma funcao de 145 linhas que fazia as tres coisas, escolhia o
 * provedor num switch e ainda mexia no IndexedDB.
 */

import type { Dub } from '../../domain/entities/Dub.ts';
import { hasSameSpokenContent } from '../../domain/entities/Dub.ts';
import { buildDub, withCompletion } from '../../domain/entities/Dub.builder.ts';
import type { DubSegment } from '../../domain/entities/Segment.ts';
import { JobStatus } from '../../domain/entities/JobStatus.ts';
import type { Lecture } from '../../domain/entities/Lecture.ts';
import { describeOrigin } from '../../domain/entities/Transcript.ts';
import { DubKey } from '../../domain/value-objects/DubKey.ts';
import { roundToMillis } from '../../domain/value-objects/TimeRange.ts';
import { polishForSpeech } from '../../domain/services/SpeechTextPolisher.ts';
import { synthesisOrder } from '../../domain/services/SynthesisOrder.ts';
import type { EngineCapabilityMap } from '../../domain/services/EngineCapabilities.ts';
import type { EngineSelection } from '../../domain/services/EngineResolver.ts';
import type { Settings } from '../dto/Settings.ts';
import type { JobProgress } from '../dto/JobProgress.ts';
import type { ClipRepository, DubRepository } from '../ports/repositories.ts';
import type { ProgressReporter } from '../ports/ProgressReporter.ts';
import type { Clock } from '../ports/Clock.ts';
import type { CancellationSignal } from '../services/CancellationToken.ts';
import type { TtsRegistry } from '../services/TtsRegistry.ts';
import { selectEngines } from '../services/ResolveEngineSelection.ts';
import type { BuildTranscript } from './BuildTranscript.ts';
import type { TranslateSegments } from './TranslateSegments.ts';
import type { SynthesizeSegments } from './SynthesizeSegments.ts';
import type { EnforceCacheLimit } from './EnforceCacheLimit.ts';

export interface DubLectureInput {
  readonly lecture: Lecture;
  readonly settings: Settings;
  readonly startAt: number;
  /** Refaz tudo, mesmo que o conteudo falado nao tenha mudado. */
  readonly force: boolean;
  readonly reporter: ProgressReporter;
  readonly signal: CancellationSignal;
}

export interface DubLectureDeps {
  readonly buildTranscript: BuildTranscript;
  readonly translateSegments: TranslateSegments;
  readonly synthesizeSegments: SynthesizeSegments;
  readonly enforceCacheLimit: EnforceCacheLimit;
  readonly registry: TtsRegistry;
  readonly dubs: DubRepository;
  readonly clips: ClipRepository;
  readonly capabilities: EngineCapabilityMap;
  readonly clock: Clock;
}

interface PreparedSegments {
  readonly segments: readonly DubSegment[];
  readonly origin: string;
}

export class DubLecture {
  private readonly deps: DubLectureDeps;

  constructor(deps: DubLectureDeps) {
    this.deps = deps;
  }

  async execute(input: DubLectureInput): Promise<Dub> {
    const selection = selectEngines(input.settings, this.deps.capabilities);
    const key = DubKey.from({
      lectureId: input.lecture.lectureId,
      targetLang: input.settings.targetLang,
      ttsEngine: selection.ttsEngine,
      voice: selection.voice
    });

    const notes = [...selection.notes];
    const report = (patch: JobProgress): void =>
      input.reporter.report({ key: key.toString(), notes, ...patch });

    report({ status: JobStatus.CONTEXT, message: 'Preparando' });

    const prepared = await this.prepareSegments(input, selection, notes);
    input.signal.throwIfCanceled();

    const opened = await this.openDub(input, selection, key, prepared, notes);

    await this.preflight(input, selection, opened.dub, opened.alreadyDone, notes);
    input.signal.throwIfCanceled();

    report({
      status: JobStatus.SYNTHESIZING,
      done: opened.alreadyDone.size,
      total: prepared.segments.length,
      message: 'Gerando a voz em ' + input.settings.targetLang
    });

    const order = synthesisOrder({
      segments: prepared.segments,
      startAt: input.startAt,
      startFromPlayhead: input.settings.startFromPlayhead,
      alreadyDone: opened.alreadyDone
    });

    const result = await this.deps.synthesizeSegments.execute({
      dub: opened.dub,
      order,
      engine: selection.ttsEngine,
      voice: selection.voice,
      targetLang: input.settings.targetLang,
      alreadyDone: opened.alreadyDone,
      signal: input.signal,
      reporter: input.reporter
    });

    if (result.failures > 0) {
      notes.push(result.failures + ' trecho(s) sem audio (falha na API).');
    }

    const finished = withCompletion(opened.dub, result.ready, notes, this.deps.clock.now());
    await this.deps.dubs.save(finished);
    await this.deps.enforceCacheLimit.execute(input.settings.cacheMaxDubs);

    report({
      status: JobStatus.DONE,
      done: result.ready,
      total: prepared.segments.length,
      failures: result.failures
    });

    return finished;
  }

  /** Texto original, traduzido e polido para a fala. */
  private async prepareSegments(
    input: DubLectureInput,
    selection: EngineSelection,
    notes: string[]
  ): Promise<PreparedSegments> {
    const transcript = await this.deps.buildTranscript.execute({
      lecture: input.lecture,
      sourceLang: input.settings.sourceLang,
      sttProvider: selection.sttProvider,
      signal: input.signal,
      reporter: input.reporter
    });
    notes.push(...transcript.notes);
    input.signal.throwIfCanceled();

    const translations = await this.deps.translateSegments.execute({
      segments: transcript.segments,
      from: input.settings.sourceLang,
      to: input.settings.targetLang,
      signal: input.signal,
      reporter: input.reporter
    });

    // o texto que vai ao sintetizador precisa ser frase corrida e pontuada
    const spoken = polishForSpeech(translations);

    return {
      origin: describeOrigin(transcript.origin),
      segments: transcript.segments.map((segment, index) => ({
        index,
        start: roundToMillis(segment.start),
        end: roundToMillis(segment.end),
        sourceText: segment.text,
        targetText: spoken[index] || segment.text
      }))
    };
  }

  /**
   * Abre a dublagem no cache. Se o conteudo falado e identico ao que ja existe,
   * o audio ja gerado e reaproveitado: trocar so a data de uma legenda nao pode
   * custar uma aula inteira de sintese.
   */
  private async openDub(
    input: DubLectureInput,
    selection: EngineSelection,
    key: DubKey,
    prepared: PreparedSegments,
    notes: readonly string[]
  ): Promise<{ dub: Dub; alreadyDone: Set<number> }> {
    const existing = await this.deps.dubs.find(key.toString());
    const reusable = existing !== null && hasSameSpokenContent(existing, prepared.segments);

    if (existing && (input.force || !reusable)) {
      await this.deps.dubs.delete(key.toString());
    }

    const alreadyDone =
      input.force || !reusable
        ? new Set<number>()
        : await this.deps.clips.synthesizedIndexes(key.toString());

    const dub = buildDub({
      key,
      lecture: input.lecture,
      sourceLang: input.settings.sourceLang,
      targetLang: input.settings.targetLang,
      sttProvider: selection.sttProvider,
      ttsEngine: selection.ttsEngine,
      voice: selection.voice,
      transcriptOrigin: prepared.origin,
      segments: prepared.segments,
      notes,
      now: this.deps.clock.now(),
      previous: existing ?? undefined
    });

    await this.deps.dubs.save({ ...dub, ready: alreadyDone.size });
    return { dub, alreadyDone };
  }

  /** Falha cedo, antes de gastar tempo: servidor desligado, credito no fim. */
  private async preflight(
    input: DubLectureInput,
    selection: EngineSelection,
    dub: Dub,
    alreadyDone: ReadonlySet<number>,
    notes: string[]
  ): Promise<void> {
    const synthesizer = this.deps.registry.get(selection.ttsEngine);
    if (!synthesizer.preflight) return;

    const estimatedChars = dub.segments
      .filter((segment) => !alreadyDone.has(segment.index))
      .reduce((total, segment) => total + segment.targetText.length, 0);

    const result = await synthesizer.preflight({
      voice: selection.voice,
      targetLang: input.settings.targetLang,
      estimatedChars
    });
    notes.push(...result.notes);
  }
}
