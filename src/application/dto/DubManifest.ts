/**
 * O que o player recebe para tocar uma dublagem.
 *
 * Deliberadamente SEM o audio: sao so os tempos e os textos. O audio de cada
 * trecho e pedido sob demanda, porque uma aula de uma hora passa de 100 MB e
 * mandar isso por mensagem travaria a aba.
 */

import type { JobStatus } from '../../domain/entities/JobStatus.ts';
import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import type { SttProviderId, TtsEngineId, VoiceId } from '../../domain/value-objects/EngineId.ts';
import type { Dub } from '../../domain/entities/Dub.ts';

export interface ManifestSegment {
  readonly i: number;
  readonly start: number;
  readonly end: number;
  readonly txt: string;
}

export interface DubManifest {
  readonly key: string;
  readonly lectureId: string;
  readonly title: string;
  readonly targetLang: LanguageTag;
  readonly ttsEngine: TtsEngineId;
  readonly voice: VoiceId | null;
  readonly sttProvider: SttProviderId;
  readonly status: JobStatus;
  readonly total: number;
  readonly ready: number;
  readonly notes: readonly string[];
  readonly segments: readonly ManifestSegment[];
  readonly updatedAt: number;
}

export function toManifest(dub: Dub): DubManifest {
  return {
    key: dub.key,
    lectureId: dub.lectureId,
    title: dub.title,
    targetLang: dub.targetLang,
    ttsEngine: dub.ttsEngine,
    voice: dub.voice,
    sttProvider: dub.sttProvider,
    status: dub.status,
    total: dub.total,
    ready: dub.ready,
    notes: dub.notes,
    segments: dub.segments.map((segment) => ({
      i: segment.index,
      start: segment.start,
      end: segment.end,
      txt: segment.targetText
    })),
    updatedAt: dub.updatedAt
  };
}

/** Resumo para a lista de cache do popup, sem carregar os segmentos. */
export interface DubSummary {
  readonly key: string;
  readonly title: string;
  readonly lectureId: string;
  readonly targetLang: LanguageTag;
  readonly ttsEngine: TtsEngineId;
  readonly ready: number;
  readonly total: number;
  readonly status: JobStatus;
  readonly updatedAt: number;
}
