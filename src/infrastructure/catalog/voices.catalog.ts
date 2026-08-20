/*
 * Catalogos de voz e idioma.
 *
 * Sao fatos sobre servicos externos, nao regras de negocio, por isso vivem em
 * infrastructure. O dominio recebe o recorte de que precisa (EngineCapability)
 * e nunca importa este arquivo.
 */

import type { VoiceId } from '../../domain/value-objects/EngineId.ts';

/** Vozes do Deepgram Aura-2 por idioma. Nao ha portugues no catalogo deles. */
export const DEEPGRAM_VOICES: Readonly<Record<string, readonly VoiceId[]>> = {
  en: [
    'aura-2-thalia-en',
    'aura-2-andromeda-en',
    'aura-2-apollo-en',
    'aura-2-arcas-en',
    'aura-2-asteria-en',
    'aura-2-athena-en',
    'aura-2-aurora-en',
    'aura-2-helena-en',
    'aura-2-hera-en',
    'aura-2-luna-en',
    'aura-2-orion-en',
    'aura-2-orpheus-en',
    'aura-2-selene-en',
    'aura-2-theia-en',
    'aura-2-zeus-en'
  ],
  es: [
    'aura-2-celeste-es',
    'aura-2-estrella-es',
    'aura-2-diana-es',
    'aura-2-selena-es',
    'aura-2-sirio-es',
    'aura-2-nestor-es',
    'aura-2-javier-es',
    'aura-2-alvaro-es'
  ],
  de: ['aura-2-julius-de'],
  fr: ['aura-2-agathe-fr'],
  nl: ['aura-2-rhea-nl'],
  it: ['aura-2-livia-it'],
  ja: ['aura-2-fujin-ja']
};

export interface VoiceOption {
  readonly code: VoiceId;
  readonly label: string;
}

/** Vozes pt-BR do Kokoro 82M (lang_code p). */
export const KOKORO_PT_VOICES: readonly VoiceOption[] = [
  { code: 'pm_alex', label: 'Alex — masculina' },
  { code: 'pm_santa', label: 'Santa — masculina, mais grave' },
  { code: 'pf_dora', label: 'Dora — feminina' }
];

/** Vozes em portugues do Inworld. A API tem 280+ no total, filtraveis por idioma. */
export const INWORLD_PT_VOICES: readonly VoiceOption[] = [
  { code: 'Heitor', label: 'Heitor — masculina, neutra' },
  { code: 'Murilo', label: 'Murilo — masculina, calma' },
  { code: 'Bruna', label: 'Bruna — feminina, conversacional (BR)' },
  { code: 'Renata', label: 'Renata — feminina, calma (BR)' },
  { code: 'Patricia', label: 'Patricia — feminina, expressiva (BR)' },
  { code: 'Tatiana', label: 'Tatiana — feminina, natural (BR)' },
  { code: 'Vanessa', label: 'Vanessa — feminina, envolvente (BR)' },
  { code: 'Larissa', label: 'Larissa — feminina, brilhante (BR)' },
  { code: 'Mariana', label: 'Mariana — feminina, jovem (BR)' },
  { code: 'Maitê', label: 'Maitê — feminina, madura' },
  { code: 'Matilde', label: 'Matilde — feminina (PT)' },
  { code: 'Leonor', label: 'Leonor — feminina (PT)' },
  { code: 'Beatriz', label: 'Beatriz — feminina (PT)' },
  { code: 'Madalena', label: 'Madalena — feminina (PT)' }
];

export const INWORLD_MODELS: readonly VoiceOption[] = [
  { code: 'inworld-tts-2', label: 'TTS-2 (melhor qualidade)' },
  { code: 'inworld-tts-2-flash', label: 'TTS-2 Flash (mais rapido)' },
  { code: 'inworld-tts-1', label: 'TTS-1' },
  { code: 'inworld-tts-1-max', label: 'TTS-1 Max' }
];

/**
 * Idioma que uma voz do Piper fala, lido do proprio nome do modelo:
 * pt_BR-faber-medium indica portugues.
 */
export function piperVoiceLanguage(voice: VoiceId): string | null {
  const prefix = String(voice).split('-')[0]?.split('_')[0]?.toLowerCase();
  return prefix || null;
}

/** As vozes portuguesas do Kokoro comecam com p (pm_alex, pf_dora). */
export function kokoroVoiceLanguage(voice: VoiceId): string | null {
  return String(voice).startsWith('p') ? 'pt' : null;
}
