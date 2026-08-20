/**
 * Traduz as preferencias do usuario para a entrada que o dominio entende.
 *
 * O resolver de dominio nao conhece o formato do Settings nem os nomes dos
 * campos de chave de API. Este servico faz essa destilacao e e o unico lugar
 * que sabe que `elevenApiKey` preenchida significa credencial do ElevenLabs.
 */

import { resolveEngines } from '../../domain/services/EngineResolver.ts';
import type { EngineSelection } from '../../domain/services/EngineResolver.ts';
import type { EngineCapabilityMap } from '../../domain/services/EngineCapabilities.ts';
import type { Settings } from '../dto/Settings.ts';

/** Qual campo de Settings guarda a credencial de cada provedor. */
const CREDENTIAL_FIELDS = {
  deepgram: 'deepgramApiKey',
  elevenlabs: 'elevenApiKey',
  inworld: 'inworldApiKey'
} as const satisfies Record<string, keyof Settings>;

function credentialsIn(settings: Settings): ReadonlySet<string> {
  const filled = new Set<string>();
  for (const [provider, field] of Object.entries(CREDENTIAL_FIELDS)) {
    if (String(settings[field] ?? '').trim()) filled.add(provider);
  }
  return filled;
}

export function selectEngines(
  settings: Settings,
  capabilities: EngineCapabilityMap
): EngineSelection {
  return resolveEngines(
    {
      preset: settings.provider,
      requestedStt: settings.sttProvider,
      requestedTts: settings.ttsEngine,
      targetLang: settings.targetLang,
      selectedVoices: {
        piper: settings.piperVoice,
        kokoro: settings.kokoroVoice,
        f5: settings.f5Voice,
        inworld: settings.inworldVoiceId,
        elevenlabs: settings.elevenVoiceId,
        deepgram: settings.deepgramVoice
      },
      credentials: credentialsIn(settings)
    },
    capabilities
  );
}
