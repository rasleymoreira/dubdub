/*
 * Resolucao dos motores de transcricao e de voz (Chain of Responsibility).
 *
 * O usuario escolhe um preset e, opcionalmente, ajustes finos. O que ele pediu
 * nem sempre e possivel: falta credencial, o Deepgram nao tem voz em portugues,
 * a voz do Piper fala outro idioma. Antes isso era uma cascata de if/else de 64
 * linhas onde cada regra nova entrava no meio das outras e nenhuma podia ser
 * testada isolada.
 *
 * Agora cada regra e um elo independente: recebe a selecao corrente, devolve a
 * selecao ajustada e, quando ajusta, explica por que. Adicionar uma regra e
 * inserir um elo; testar uma regra e chamar uma funcao.
 */

import type { LanguageTag } from '../value-objects/LanguageCode.ts';
import { baseLanguage } from '../value-objects/LanguageCode.ts';
import type { SttProviderId, TtsEngineId, VoiceId } from '../value-objects/EngineId.ts';
import type { EngineCapabilityMap } from './EngineCapabilities.ts';
import { voicesFor } from './EngineCapabilities.ts';

/** Motor usado quando o escolhido nao pode rodar: nao exige credencial nenhuma. */
const FALLBACK_ENGINE: TtsEngineId = 'google';

export interface EngineResolutionInput {
  /** Preset principal do popup, que define stt e tts de uma vez. */
  readonly preset: 'deepgram' | 'google';
  readonly requestedStt: 'auto' | SttProviderId;
  readonly requestedTts: 'auto' | TtsEngineId;
  readonly targetLang: LanguageTag;
  /** Voz configurada para cada motor. */
  readonly selectedVoices: Readonly<Partial<Record<TtsEngineId, VoiceId>>>;
  /** Provedores com credencial preenchida (deepgram, elevenlabs, inworld). */
  readonly credentials: ReadonlySet<string>;
}

export interface EngineSelection {
  readonly sttProvider: SttProviderId;
  readonly ttsEngine: TtsEngineId;
  readonly voice: VoiceId | null;
  /** Avisos legiveis, exibidos no popup e no painel da aula. */
  readonly notes: readonly string[];
}

interface ResolutionContext {
  readonly input: EngineResolutionInput;
  readonly capabilities: EngineCapabilityMap;
}

interface ResolutionRule {
  readonly name: string;
  apply(selection: EngineSelection, context: ResolutionContext): EngineSelection;
}

function withNote(selection: EngineSelection, note: string): EngineSelection {
  return { ...selection, notes: [...selection.notes, note] };
}

function fallbackTo(
  selection: EngineSelection,
  engine: TtsEngineId,
  note: string
): EngineSelection {
  return { ...selection, ttsEngine: engine, voice: null, notes: [...selection.notes, note] };
}

// ------------------------------------------------------------------- os elos

/** O valor auto vira o motor de transcricao derivado do preset. */
const resolveStt: ResolutionRule = {
  name: 'resolveStt',
  apply(selection, { input }) {
    if (input.requestedStt !== 'auto') return { ...selection, sttProvider: input.requestedStt };
    return { ...selection, sttProvider: input.preset === 'deepgram' ? 'deepgram' : 'captions' };
  }
};

/** Sem credencial do Deepgram nao ha transcricao paga: sobram as legendas. */
const sttNeedsCredential: ResolutionRule = {
  name: 'sttNeedsCredential',
  apply(selection, { input }) {
    if (selection.sttProvider !== 'deepgram' || input.credentials.has('deepgram')) return selection;
    return {
      ...withNote(selection, 'Sem API key do Deepgram: usando as legendas da Udemy.'),
      sttProvider: 'captions'
    };
  }
};

/** O valor auto vira o motor de voz derivado do preset. */
const resolveTts: ResolutionRule = {
  name: 'resolveTts',
  apply(selection, { input }) {
    if (input.requestedTts !== 'auto') return { ...selection, ttsEngine: input.requestedTts };
    return { ...selection, ttsEngine: input.preset === 'deepgram' ? 'deepgram' : FALLBACK_ENGINE };
  }
};

/** Aplica a voz que o usuario configurou para o motor resolvido. */
const assignVoice: ResolutionRule = {
  name: 'assignVoice',
  apply(selection, { input }) {
    if (selection.ttsEngine === 'google') return { ...selection, voice: null };
    return { ...selection, voice: input.selectedVoices[selection.ttsEngine] ?? null };
  }
};

/** O motor nao tem voz nenhuma no idioma de destino (Deepgram em portugues). */
const voiceMustExistForLanguage: ResolutionRule = {
  name: 'voiceMustExistForLanguage',
  apply(selection, { input, capabilities }) {
    const capability = capabilities[selection.ttsEngine];
    const voices = voicesFor(capability, input.targetLang, baseLanguage);
    if (voices === null || voices.length > 0) return selection;

    return fallbackTo(
      selection,
      FALLBACK_ENGINE,
      capability.label +
        ' nao tem voz em ' +
        input.targetLang +
        ': a voz sera gerada pelo Google TTS.'
    );
  }
};

/** A voz configurada nao serve para o idioma, mas existe outra que serve. */
const correctVoiceForLanguage: ResolutionRule = {
  name: 'correctVoiceForLanguage',
  apply(selection, { input, capabilities }) {
    const capability = capabilities[selection.ttsEngine];
    const voices = voicesFor(capability, input.targetLang, baseLanguage);
    if (!voices || voices.length === 0) return selection;
    if (selection.voice && voices.includes(selection.voice)) return selection;

    const replacement = voices[0]!;
    return {
      ...withNote(
        selection,
        'Voz ajustada para ' + replacement + ' (compativel com o idioma escolhido).'
      ),
      voice: replacement
    };
  }
};

/** Motor pago sem credencial preenchida. */
const ttsNeedsCredential: ResolutionRule = {
  name: 'ttsNeedsCredential',
  apply(selection, { input, capabilities }) {
    const capability = capabilities[selection.ttsEngine];
    if (!capability.requiresApiKey || input.credentials.has(selection.ttsEngine)) return selection;

    return fallbackTo(
      selection,
      FALLBACK_ENGINE,
      'Sem API key do ' + capability.label + ': voz gerada pelo Google TTS.'
    );
  }
};

/**
 * A voz funciona, mas fala outro idioma. Nao e impeditivo, o motor sintetiza
 * assim mesmo, so com sotaque errado, entao vira aviso e nao troca.
 */
const warnVoiceLanguageMismatch: ResolutionRule = {
  name: 'warnVoiceLanguageMismatch',
  apply(selection, { input, capabilities }) {
    const capability = capabilities[selection.ttsEngine];
    if (!capability.languageOfVoice || !selection.voice) return selection;

    const spoken = capability.languageOfVoice(selection.voice);
    if (!spoken || spoken === baseLanguage(input.targetLang)) return selection;

    return withNote(
      selection,
      'A voz ' + selection.voice + ' fala ' + spoken + ', mas o destino e ' + input.targetLang + '.'
    );
  }
};

/** F5-TTS clona uma referencia: sem referencia escolhida, o servidor chuta. */
const warnMissingVoiceReference: ResolutionRule = {
  name: 'warnMissingVoiceReference',
  apply(selection, { capabilities }) {
    const capability = capabilities[selection.ttsEngine];
    if (!capability.requiresVoiceReference || selection.voice) return selection;

    return withNote(
      selection,
      'Sem referencia escolhida: o servidor usa a primeira de models/f5-ref.'
    );
  }
};

/** A ordem importa: idioma antes de credencial, para o aviso mais util vencer. */
const CHAIN: readonly ResolutionRule[] = [
  resolveStt,
  sttNeedsCredential,
  resolveTts,
  assignVoice,
  voiceMustExistForLanguage,
  correctVoiceForLanguage,
  ttsNeedsCredential,
  warnVoiceLanguageMismatch,
  warnMissingVoiceReference
];

export function resolveEngines(
  input: EngineResolutionInput,
  capabilities: EngineCapabilityMap
): EngineSelection {
  const initial: EngineSelection = {
    sttProvider: 'captions',
    ttsEngine: FALLBACK_ENGINE,
    voice: null,
    notes: []
  };

  return CHAIN.reduce((selection, rule) => rule.apply(selection, { input, capabilities }), initial);
}

/** Exportado para teste: permite exercitar um elo isolado. */
export const RULES = {
  resolveStt,
  sttNeedsCredential,
  resolveTts,
  assignVoice,
  voiceMustExistForLanguage,
  correctVoiceForLanguage,
  ttsNeedsCredential,
  warnVoiceLanguageMismatch,
  warnMissingVoiceReference
} as const;
