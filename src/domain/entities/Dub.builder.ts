/**
 * Builder da dublagem.
 *
 * O objeto tem 18 campos e antes era montado inline no meio do pipeline, com
 * os defaults ("ready comeca em zero", "createdAt preserva o antigo se houver")
 * espalhados na mesma expressao. O Builder isola essas decisoes e deixa o
 * chamador declarar so o que sabe.
 */

import type { Dub } from './Dub.ts';
import type { DubSegment } from './Segment.ts';
import { JobStatus } from './JobStatus.ts';
import type { LanguageTag } from '../value-objects/LanguageCode.ts';
import type { SttProviderId, TtsEngineId, VoiceId } from '../value-objects/EngineId.ts';
import type { Lecture } from './Lecture.ts';
import type { DubKey } from '../value-objects/DubKey.ts';

export interface DubBuilderInput {
  readonly key: DubKey;
  readonly lecture: Lecture;
  readonly sourceLang: LanguageTag;
  readonly targetLang: LanguageTag;
  readonly sttProvider: SttProviderId;
  readonly ttsEngine: TtsEngineId;
  readonly voice: VoiceId | null;
  readonly transcriptOrigin: string;
  readonly segments: readonly DubSegment[];
  readonly notes: readonly string[];
  readonly now: number;
  /** Dublagem anterior com a mesma chave, para preservar a data de criacao. */
  readonly previous?: Dub | undefined;
}

export function buildDub(input: DubBuilderInput): Dub {
  return {
    key: input.key.toString(),
    lectureId: input.lecture.lectureId,
    courseId: input.lecture.courseId,
    title: input.lecture.title,
    url: input.lecture.url,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    sttProvider: input.sttProvider,
    ttsEngine: input.ttsEngine,
    voice: input.voice,
    transcriptOrigin: input.transcriptOrigin,
    segments: input.segments,
    total: input.segments.length,
    ready: 0,
    status: JobStatus.SYNTHESIZING,
    notes: input.notes,
    createdAt: input.previous?.createdAt ?? input.now,
    updatedAt: input.now
  };
}

export function withProgress(dub: Dub, ready: number, now: number): Dub {
  return { ...dub, ready, updatedAt: now };
}

export function withCompletion(
  dub: Dub,
  ready: number,
  notes: readonly string[],
  now: number
): Dub {
  return { ...dub, ready, notes, status: JobStatus.DONE, updatedAt: now };
}
