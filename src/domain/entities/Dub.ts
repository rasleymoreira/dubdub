/**
 * Dublagem de uma aula: o agregado central do dominio.
 *
 * Guarda os segmentos com texto traduzido e o quanto ja foi sintetizado. O
 * audio em si NAO fica aqui: cada trecho vira um AudioClip com chave propria,
 * porque uma aula de uma hora passa de 100 MB e carregar isso inteiro so para
 * saber o progresso e desperdicio.
 */

import type { DubSegment } from './Segment.ts';
import type { JobStatus } from './JobStatus.ts';
import type { LanguageTag } from '../value-objects/LanguageCode.ts';
import type { SttProviderId, TtsEngineId, VoiceId } from '../value-objects/EngineId.ts';

export interface Dub {
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
  readonly transcriptOrigin: string;
  readonly segments: readonly DubSegment[];
  readonly total: number;
  readonly ready: number;
  readonly status: JobStatus;
  readonly notes: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function isComplete(dub: Dub): boolean {
  return dub.total > 0 && dub.ready >= dub.total;
}

export function progressRatio(dub: Dub): number {
  return dub.total > 0 ? dub.ready / dub.total : 0;
}

/**
 * O conteudo falado mudou? Comparar os textos evita apagar e regerar audio
 * quando a transcricao e a traducao deram no mesmo resultado de antes.
 */
export function hasSameSpokenContent(dub: Dub, segments: readonly DubSegment[]): boolean {
  if (dub.segments.length !== segments.length) return false;
  return dub.segments.every((segment, index) => segment.targetText === segments[index]?.targetText);
}
