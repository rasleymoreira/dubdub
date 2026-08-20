/**
 * Preferencias do usuario.
 *
 * Fica em application e nao em domain porque e configuracao de aplicacao, nao
 * regra de negocio: o dominio recebe o que precisa ja destilado (veja
 * EngineResolutionInput). Fica tambem fora de infrastructure porque os casos de
 * uso leem estes campos direto.
 *
 * As credenciais nascem VAZIAS. A versao anterior trazia chaves reais de
 * Deepgram, ElevenLabs e Inworld embutidas no codigo-fonte.
 */

import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import type { TtsEngineId, SttProviderId, VoiceId } from '../../domain/value-objects/EngineId.ts';

export interface Settings {
  /** Preset principal do popup: define stt e tts de uma vez. */
  readonly provider: 'deepgram' | 'google';
  readonly sttProvider: 'auto' | SttProviderId;
  readonly ttsEngine: 'auto' | TtsEngineId;

  readonly sourceLang: LanguageTag;
  readonly targetLang: LanguageTag;

  readonly deepgramApiKey: string;
  readonly deepgramSttModel: string;
  readonly deepgramVoice: VoiceId;

  readonly elevenApiKey: string;
  readonly elevenVoiceId: VoiceId;
  readonly elevenModel: string;
  readonly elevenFormat: string;

  readonly inworldApiKey: string;
  readonly inworldVoiceId: VoiceId;
  readonly inworldModel: string;
  readonly inworldBitRate: number;

  readonly piperUrl: string;
  readonly piperVoice: VoiceId;
  readonly piperLengthScale: number;
  readonly piperCuda: boolean;

  readonly kokoroUrl: string;
  readonly kokoroVoice: VoiceId;
  readonly kokoroCuda: boolean;

  readonly f5Url: string;
  readonly f5Voice: VoiceId;
  readonly f5Cuda: boolean;

  /** Volume do audio original enquanto a dublagem toca (0..1). */
  readonly originalVolume: number;
  readonly dubVolume: number;
  /** Compressao maxima da voz para caber no tempo da fala original. */
  readonly maxSpeedup: number;

  readonly autoEnable: boolean;
  readonly autoDub: boolean;
  readonly startFromPlayhead: boolean;
  readonly prefetchNext: number;
  readonly cacheMaxDubs: number;
  readonly showOverlay: boolean;
}

export type SettingsPatch = Partial<Settings>;
