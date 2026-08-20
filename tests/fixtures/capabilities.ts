/**
 * Capacidades de motor usadas nos testes de dominio.
 *
 * Deliberadamente uma fixture, e nao o catalogo real: o dominio nao deve
 * depender de infrastructure, e o teste do resolver esta verificando REGRAS de
 * fallback, nao qual voz o Deepgram lancou este mes. Se o catalogo real mudar,
 * estes testes continuam valendo.
 */

import type {
  EngineCapability,
  EngineCapabilityMap
} from '../../src/domain/services/EngineCapabilities.ts';

const noVoiceCatalog: Pick<EngineCapability, 'voicesByLanguage'> = { voicesByLanguage: null };

export const CAPABILITIES: EngineCapabilityMap = {
  google: { id: 'google', label: 'Google TTS', requiresApiKey: false, ...noVoiceCatalog },

  piper: {
    id: 'piper',
    label: 'Piper',
    requiresApiKey: false,
    ...noVoiceCatalog,
    // pt_BR-faber-medium -> pt
    languageOfVoice: (voice) => voice.split('-')[0]?.split('_')[0]?.toLowerCase() ?? null
  },

  kokoro: {
    id: 'kokoro',
    label: 'Kokoro',
    requiresApiKey: false,
    ...noVoiceCatalog,
    // as vozes pt do Kokoro comecam com p (pm_alex, pf_dora)
    languageOfVoice: (voice) => (voice.startsWith('p') ? 'pt' : null)
  },

  f5: {
    id: 'f5',
    label: 'F5-TTS',
    requiresApiKey: false,
    ...noVoiceCatalog,
    requiresVoiceReference: true
  },

  inworld: { id: 'inworld', label: 'Inworld', requiresApiKey: true, ...noVoiceCatalog },

  elevenlabs: { id: 'elevenlabs', label: 'ElevenLabs', requiresApiKey: true, ...noVoiceCatalog },

  deepgram: {
    id: 'deepgram',
    label: 'Deepgram Aura-2',
    requiresApiKey: true,
    // sem entrada para 'pt': e esse buraco que dispara o fallback
    voicesByLanguage: {
      en: ['aura-2-thalia-en', 'aura-2-zeus-en'],
      es: ['aura-2-celeste-es', 'aura-2-javier-es']
    }
  }
};
