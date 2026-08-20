/**
 * Porta de sintese de voz (Strategy).
 *
 * Antes o pipeline tinha um switch de sete ramos que importava os sete
 * provedores concretamente: a regra de negocio conhecia Deepgram, ElevenLabs,
 * Inworld, Google e os tres servidores locais por nome. Agora conhece so esta
 * interface, e quem escolhe a implementacao e o registry no composition root.
 *
 * Adicionar um motor deixou de exigir tocar no pipeline.
 */

import type { AudioClip } from '../../domain/entities/AudioClip.ts';
import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import type { TtsEngineId, VoiceId } from '../../domain/value-objects/EngineId.ts';
import type { CancellationSignal } from '../services/CancellationToken.ts';

export interface SynthesisRequest {
  readonly text: string;
  readonly voice: VoiceId | null;
  readonly targetLang: LanguageTag;
  readonly signal: CancellationSignal;
}

export interface PreflightRequest {
  readonly voice: VoiceId | null;
  readonly targetLang: LanguageTag;
  /** Total de caracteres do job, para avisar sobre credito insuficiente. */
  readonly estimatedChars: number;
}

export interface PreflightResult {
  /** Avisos legiveis, exibidos antes de comecar (credito baixo, GPU ausente). */
  readonly notes: readonly string[];
}

export interface SpeechSynthesisPort {
  readonly engine: TtsEngineId;

  /**
   * Chamadas simultaneas que este motor aguenta sem degradar. Propriedade do
   * adapter e nao do pipeline: quem sabe o limite e quem fala com o servico.
   */
  readonly concurrency: number;

  speak(request: SynthesisRequest): Promise<AudioClip>;

  /**
   * Falha cedo e com mensagem util antes de um job longo: servidor local
   * desligado, credencial invalida, credito no fim. Opcional porque motores sem
   * pre-requisito (Google TTS) nao tem o que verificar.
   */
  preflight?(request: PreflightRequest): Promise<PreflightResult>;
}
