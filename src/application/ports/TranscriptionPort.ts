/**
 * Porta de obtencao do texto original (Strategy + Chain of Responsibility).
 *
 * As fontes tem preferencia e caem umas nas outras: transcrever o audio com o
 * Deepgram da timings melhores, mas curso com DRM nao expoe mp4; ai valem as
 * legendas da Udemy; e se a API da Udemy nao responder, sobram as cues que o
 * proprio player ja carregou.
 *
 * Devolver null significa "esta fonte nao se aplica a esta aula", e nao erro:
 * e o sinal para o caso de uso tentar a proxima da cadeia.
 */

import type { Lecture } from '../../domain/entities/Lecture.ts';
import type { SourceSegment } from '../../domain/entities/Segment.ts';
import type { TranscriptOrigin } from '../../domain/entities/Transcript.ts';
import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import type { SttProviderId } from '../../domain/value-objects/EngineId.ts';
import type { CancellationSignal } from '../services/CancellationToken.ts';

export interface TranscriptionRequest {
  readonly lecture: Lecture;
  readonly sourceLang: LanguageTag;
  readonly signal: CancellationSignal;
}

export interface TranscriptionResult {
  readonly segments: readonly SourceSegment[];
  readonly origin: TranscriptOrigin;
  readonly notes: readonly string[];
}

export interface TranscriptionPort {
  readonly id: SttProviderId | 'player-cues';
  /** Rotulo curto para mensagens de progresso. */
  readonly label: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult | null>;
}
