/*
 * Formato gravado no IndexedDB e a traducao dele para o dominio.
 *
 * O formato e deliberadamente IGUAL ao da versao anterior da extensao. Nao
 * custa quase nada mapear na leitura, e custa caro ao usuario perder o cache:
 * ate oito aulas ja sintetizadas, que podem passar de 800 MB e levar mais de
 * uma hora para refazer.
 *
 * Este mapeamento e exatamente o que um repositorio serve para isolar. O
 * dominio usa nomes por extenso (sourceText, targetText); o disco usa os curtos
 * (src, txt), porque eles se repetem uma vez por trecho e sao milhares.
 */

import type { Dub } from '../../domain/entities/Dub.ts';
import type { DubSegment, SourceSegment } from '../../domain/entities/Segment.ts';
import type { Transcript, TranscriptOrigin } from '../../domain/entities/Transcript.ts';
import type { JobStatus } from '../../domain/entities/JobStatus.ts';
import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import type { SttProviderId, TtsEngineId, VoiceId } from '../../domain/value-objects/EngineId.ts';

export interface DubSegmentRecord {
  readonly i: number;
  readonly start: number;
  readonly end: number;
  readonly src: string;
  readonly txt: string;
}

export interface DubRecord {
  readonly key: string;
  readonly lectureId: string;
  readonly courseId: string | null;
  readonly title: string;
  readonly url: string;
  readonly sourceLang: LanguageTag;
  readonly targetLang: LanguageTag;
  readonly sttProvider: SttProviderId;
  readonly ttsEngine: TtsEngineId;
  readonly voice: VoiceId | null;
  readonly transcriptSource: string;
  readonly segments: readonly DubSegmentRecord[];
  readonly total: number;
  readonly ready: number;
  readonly status: JobStatus;
  readonly notes: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function toDubRecord(dub: Dub): DubRecord {
  return {
    key: dub.key,
    lectureId: dub.lectureId,
    courseId: dub.courseId,
    title: dub.title,
    url: dub.url,
    sourceLang: dub.sourceLang,
    targetLang: dub.targetLang,
    sttProvider: dub.sttProvider,
    ttsEngine: dub.ttsEngine,
    voice: dub.voice,
    transcriptSource: dub.transcriptOrigin,
    segments: dub.segments.map((segment) => ({
      i: segment.index,
      start: segment.start,
      end: segment.end,
      src: segment.sourceText,
      txt: segment.targetText
    })),
    total: dub.total,
    ready: dub.ready,
    status: dub.status,
    notes: [...dub.notes],
    createdAt: dub.createdAt,
    updatedAt: dub.updatedAt
  };
}

export function fromDubRecord(record: DubRecord): Dub {
  const segments: DubSegment[] = (record.segments ?? []).map((segment, position) => ({
    index: segment.i ?? position,
    start: segment.start,
    end: segment.end,
    sourceText: segment.src ?? '',
    targetText: segment.txt ?? ''
  }));

  return {
    key: record.key,
    lectureId: String(record.lectureId),
    courseId: record.courseId ?? null,
    title: record.title ?? '',
    url: record.url ?? '',
    sourceLang: record.sourceLang,
    targetLang: record.targetLang,
    sttProvider: record.sttProvider,
    ttsEngine: record.ttsEngine,
    voice: record.voice ?? null,
    transcriptOrigin: record.transcriptSource ?? '',
    segments,
    total: record.total ?? segments.length,
    ready: record.ready ?? 0,
    status: record.status,
    notes: record.notes ?? [],
    createdAt: record.createdAt ?? 0,
    updatedAt: record.updatedAt ?? 0
  };
}

export interface TranscriptRecord {
  readonly key: string;
  readonly lectureId: string;
  readonly segments: readonly SourceSegment[];
  /** Formato "deepgram:nova-3", "captions:en" ou "captions:player". */
  readonly source: string;
  readonly createdAt: number;
}

export function toTranscriptRecord(key: string, transcript: Transcript): TranscriptRecord {
  return {
    key,
    lectureId: transcript.lectureId,
    segments: transcript.segments,
    source: encodeOrigin(transcript.origin),
    createdAt: transcript.createdAt
  };
}

export function fromTranscriptRecord(record: TranscriptRecord): Transcript {
  return {
    lectureId: String(record.lectureId),
    segments: record.segments ?? [],
    origin: decodeOrigin(record.source ?? ''),
    createdAt: record.createdAt ?? 0
  };
}

function encodeOrigin(origin: TranscriptOrigin): string {
  switch (origin.kind) {
    case 'deepgram':
      return `deepgram:${origin.model}`;
    case 'captions':
      return `captions:${origin.locale}`;
    case 'player-cues':
      return 'captions:player';
  }
}

function decodeOrigin(source: string): TranscriptOrigin {
  const [kind, detail = ''] = source.split(':');
  if (kind === 'deepgram') return { kind: 'deepgram', model: detail };
  if (detail === 'player') return { kind: 'player-cues' };
  return { kind: 'captions', locale: detail };
}

export interface ClipRecord {
  readonly key: string;
  readonly dubId: string;
  readonly index: number;
  readonly parts: readonly string[];
  readonly mime: string;
  readonly start: number;
  readonly end: number;
}

export interface TranslationRecord {
  readonly key: string;
  readonly text: string;
  readonly createdAt: number;
}
