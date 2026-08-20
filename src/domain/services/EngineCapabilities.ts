/*
 * O que o dominio precisa saber sobre cada motor para decidir fallbacks.
 *
 * A lista concreta de vozes do Deepgram e um fato sobre um servico externo e
 * vive no catalogo, em infrastructure. Mas a REGRA "sem voz no idioma de
 * destino, caia para o Google" e negocio e vive aqui. Este tipo e o contrato
 * entre os dois: o dominio declara o que precisa e recebe pronto.
 */

import type { LanguageTag } from '../value-objects/LanguageCode.ts';
import type { TtsEngineId, VoiceId } from '../value-objects/EngineId.ts';

export interface EngineCapability {
  readonly id: TtsEngineId;
  readonly label: string;
  /** O motor so funciona com credencial configurada. */
  readonly requiresApiKey: boolean;
  /**
   * Vozes por idioma base ('en', 'pt'). `null` quando o motor atende qualquer
   * idioma ou quando o catalogo nao e conhecido de antemao (servidores locais,
   * cuja lista sai do proprio servidor).
   */
  readonly voicesByLanguage: Readonly<Record<string, readonly VoiceId[]>> | null;
  /**
   * Infere o idioma a partir do id da voz, quando o id codifica isso
   * (pt_BR-faber-medium indica portugues). `null` quando nao da para saber.
   */
  readonly languageOfVoice?: (voice: VoiceId) => string | null;
  /** O motor exige um audio de referencia escolhido pelo usuario (F5-TTS). */
  readonly requiresVoiceReference?: boolean;
}

export type EngineCapabilityMap = Readonly<Record<TtsEngineId, EngineCapability>>;

export function voicesFor(
  capability: EngineCapability,
  language: LanguageTag,
  baseOf: (code: LanguageTag) => string
): readonly VoiceId[] | null {
  if (!capability.voicesByLanguage) return null;
  return capability.voicesByLanguage[baseOf(language)] ?? [];
}
