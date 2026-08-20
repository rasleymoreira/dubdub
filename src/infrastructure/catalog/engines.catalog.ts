/*
 * FONTE UNICA do catalogo de motores de voz.
 *
 * Antes o mesmo motor era descrito em cinco lugares: TTS_ENGINES no
 * constants.js, LOCAL_TTS no service worker, LOCAL_ENGINES no pipeline,
 * LOCAL_PANELS no popup e ENGINES no host de native messaging. Adicionar um
 * motor exigia editar os cinco e lembrar de todos (Shotgun Surgery); esquecer um
 * dava bug silencioso, como o popup mostrar um painel que o pipeline nao sabia
 * atender.
 *
 * Agora cada motor e descrito aqui uma vez e o resto DERIVA:
 *
 *   - o dominio recebe ENGINE_CAPABILITIES para decidir fallbacks;
 *   - o popup monta os paineis de ajuste a partir de TTS_ENGINE_CATALOG;
 *   - o composition root monta os adapters a partir do mesmo catalogo;
 *   - o build exporta LOCAL_SERVER_CATALOG para engines.generated.json, que o
 *     host de native messaging le em vez de manter a sexta copia.
 *
 * Adicionar um motor novo passa a ser: um adapter e uma entrada aqui.
 */

import type {
  EngineCapability,
  EngineCapabilityMap
} from '../../domain/services/EngineCapabilities.ts';
import type { LocalTtsEngineId, TtsEngineId } from '../../domain/value-objects/EngineId.ts';
import { DEEPGRAM_VOICES, kokoroVoiceLanguage, piperVoiceLanguage } from './voices.catalog.ts';

// --------------------------------------------------------------- para a UI

/** Campo de ajuste que o popup renderiza para um motor. */
export type EngineFieldKind = 'text' | 'select' | 'checkbox' | 'password';

export interface EngineField {
  /** Chave em Settings. */
  readonly setting: string;
  readonly label: string;
  readonly kind: EngineFieldKind;
  readonly hint?: string;
}

export interface TtsEngineDescriptor {
  readonly id: TtsEngineId;
  readonly label: string;
  /** Frase curta explicando o compromisso do motor, mostrada no popup. */
  readonly hint: string;
  /** Roda em servidor HTTP na maquina do usuario. */
  readonly local: boolean;
  /** Chamadas simultaneas que o motor aguenta sem degradar. */
  readonly concurrency: number;
  readonly fields: readonly EngineField[];
}

/** A ordem aqui e a ordem no seletor do popup. */
export const TTS_ENGINE_CATALOG: readonly TtsEngineDescriptor[] = [
  {
    id: 'kokoro',
    label: 'Kokoro (local)',
    hint: 'Voz mais natural que o Piper, offline e sem custo. ~5x tempo real.',
    local: true,
    concurrency: 2,
    fields: [
      { setting: 'kokoroUrl', label: 'Servidor', kind: 'text' },
      { setting: 'kokoroVoice', label: 'Voz', kind: 'select' },
      { setting: 'kokoroCuda', label: 'Usar GPU (CUDA)', kind: 'checkbox' }
    ]
  },
  {
    id: 'piper',
    label: 'Piper (local)',
    hint: 'A mais rapida (38x tempo real), mas a voz e a mais robotica.',
    local: true,
    concurrency: 2,
    fields: [
      { setting: 'piperUrl', label: 'Servidor', kind: 'text' },
      { setting: 'piperVoice', label: 'Voz', kind: 'text' },
      {
        setting: 'piperCuda',
        label: 'Usar GPU (CUDA)',
        kind: 'checkbox',
        hint: 'Medido: a CPU e mais rapida nos modelos medium.'
      }
    ]
  },
  {
    id: 'f5',
    label: 'F5-TTS (local)',
    hint: 'Clona a voz de um audio de referencia. Precisa de GPU e e uso nao comercial.',
    local: true,
    concurrency: 1,
    fields: [
      { setting: 'f5Url', label: 'Servidor', kind: 'text' },
      { setting: 'f5Voice', label: 'Referencia', kind: 'text' },
      { setting: 'f5Cuda', label: 'Usar GPU (CUDA)', kind: 'checkbox' }
    ]
  },
  {
    id: 'inworld',
    label: 'Inworld',
    hint: 'Vozes neurais em pt-BR (Heitor, Bruna, Renata...). Cobra por caractere.',
    local: false,
    concurrency: 3,
    fields: [
      { setting: 'inworldApiKey', label: 'API key', kind: 'password' },
      { setting: 'inworldVoiceId', label: 'Voz', kind: 'select' },
      { setting: 'inworldModel', label: 'Modelo', kind: 'select' }
    ]
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    hint: 'Melhor qualidade em pt-BR. Consome creditos da conta.',
    local: false,
    concurrency: 3,
    fields: [
      { setting: 'elevenApiKey', label: 'API key', kind: 'password' },
      { setting: 'elevenVoiceId', label: 'Voz', kind: 'select' },
      { setting: 'elevenModel', label: 'Modelo', kind: 'text' }
    ]
  },
  {
    id: 'google',
    label: 'Google TTS',
    hint: 'Sem API key e sem custo. Voz robotica.',
    local: false,
    concurrency: 2,
    fields: []
  },
  {
    id: 'deepgram',
    label: 'Deepgram Aura-2',
    hint: 'Sem voz em portugues (en, es, de, fr, nl, it, ja).',
    local: false,
    concurrency: 4,
    fields: [
      { setting: 'deepgramApiKey', label: 'API key', kind: 'password' },
      { setting: 'deepgramVoice', label: 'Voz', kind: 'select' }
    ]
  }
];

export function describeEngine(id: TtsEngineId): TtsEngineDescriptor {
  const found = TTS_ENGINE_CATALOG.find((engine) => engine.id === id);
  if (!found) throw new Error(`motor desconhecido no catalogo: ${id}`);
  return found;
}

// ----------------------------------------------------------- para o dominio

function capability(
  id: TtsEngineId,
  overrides: Partial<Omit<EngineCapability, 'id' | 'label'>> = {}
): EngineCapability {
  return {
    id,
    label: describeEngine(id).label,
    requiresApiKey: false,
    voicesByLanguage: null,
    ...overrides
  };
}

/** O recorte que o EngineResolver precisa para decidir fallbacks. */
export const ENGINE_CAPABILITIES: EngineCapabilityMap = {
  kokoro: capability('kokoro', { languageOfVoice: kokoroVoiceLanguage }),
  piper: capability('piper', { languageOfVoice: piperVoiceLanguage }),
  f5: capability('f5', { requiresVoiceReference: true }),
  inworld: capability('inworld', { requiresApiKey: true }),
  elevenlabs: capability('elevenlabs', { requiresApiKey: true }),
  google: capability('google'),
  deepgram: capability('deepgram', { requiresApiKey: true, voicesByLanguage: DEEPGRAM_VOICES })
};

// -------------------------------------------- para o host de native messaging

/**
 * Como lancar cada servidor local.
 *
 * Serializavel de proposito: o build grava isto em
 * tools/native-host/engines.generated.json e o host, que roda como processo
 * Node separado e nao passa pelo bundle, le esse arquivo. Por isso nao ha
 * funcao nenhuma aqui, so dados e templates de argumento.
 *
 * Os placeholders {voice}, {port} e {models} sao substituidos pelo host.
 */
export interface LocalServerDescriptor {
  readonly id: LocalTtsEngineId;
  readonly label: string;
  /** Diretorio do virtualenv, relativo a raiz do projeto. */
  readonly venv: string;
  readonly pidFile: string;
  readonly logFile: string;
  readonly defaultPort: number;
  readonly defaultVoice: string;
  /** Sem voz definida o servidor escolhe sozinho (caso do F5). */
  readonly allowEmptyVoice: boolean;
  /** Quanto esperar a porta responder antes de desistir. */
  readonly startTimeoutMs: number;
  readonly setupHint: string;
  /** Modulo Python (python -m X) ou script solto. */
  readonly launch:
    | { readonly kind: 'module'; readonly target: string }
    | { readonly kind: 'script'; readonly target: string };
  readonly args: readonly string[];
  /** Argumentos acrescentados so quando ha voz escolhida. */
  readonly voiceArgs: readonly string[];
  readonly cudaArgs: readonly string[];
  readonly cpuArgs: readonly string[];
  /** Arquivo que precisa existir para a voz funcionar, com {voice}. */
  readonly voiceModelPath?: string;
  readonly voiceMissingHint?: string;
}

export const LOCAL_SERVER_CATALOG: Readonly<Record<LocalTtsEngineId, LocalServerDescriptor>> = {
  piper: {
    id: 'piper',
    label: 'Piper',
    venv: '.venv',
    pidFile: '.piper.pid',
    logFile: 'piper-server.log',
    defaultPort: 5000,
    defaultVoice: 'pt_BR-faber-medium',
    allowEmptyVoice: false,
    startTimeoutMs: 25000,
    setupHint: 'Rode tools\\start-piper.ps1 uma vez para criar o .venv.',
    launch: { kind: 'module', target: 'piper.http_server' },
    args: ['--data-dir', '{models}', '--port', '{port}'],
    voiceArgs: ['-m', '{voice}'],
    cudaArgs: ['--cuda'],
    cpuArgs: [],
    voiceModelPath: 'models/{voice}.onnx',
    voiceMissingHint:
      'Voz {voice} nao baixada. Rode: .venv\\Scripts\\python.exe -m piper.download_voices {voice} --download-dir models'
  },
  kokoro: {
    id: 'kokoro',
    label: 'Kokoro',
    venv: '.venv-kokoro',
    pidFile: '.kokoro.pid',
    logFile: 'kokoro-server.log',
    defaultPort: 5001,
    defaultVoice: 'pm_alex',
    allowEmptyVoice: false,
    // a primeira execucao baixa o modelo (~330 MB)
    startTimeoutMs: 180000,
    setupHint:
      'Crie o ambiente: py -3.12 -m venv .venv-kokoro e .venv-kokoro\\Scripts\\python.exe -m pip install kokoro soundfile',
    launch: { kind: 'script', target: 'tools/kokoro_server.py' },
    args: ['--port', '{port}'],
    voiceArgs: ['--voice', '{voice}'],
    cudaArgs: ['--device', 'cuda'],
    cpuArgs: []
  },
  f5: {
    id: 'f5',
    label: 'F5-TTS',
    venv: '.venv-f5',
    pidFile: '.f5.pid',
    logFile: 'f5-server.log',
    defaultPort: 5002,
    defaultVoice: '',
    // sem voz definida o servidor usa a primeira referencia de models/f5-ref
    allowEmptyVoice: true,
    // carrega ~1,3 GB de checkpoint
    startTimeoutMs: 240000,
    setupHint: 'Rode tools\\install-f5.ps1 uma vez.',
    launch: { kind: 'script', target: 'tools/f5_server.py' },
    args: ['--port', '{port}'],
    voiceArgs: ['--voice', '{voice}'],
    cudaArgs: ['--device', 'cuda'],
    cpuArgs: ['--device', 'cpu']
  }
};

/** Chaves em Settings que guardam a URL e a voz de cada servidor local. */
export const LOCAL_SETTING_KEYS: Readonly<
  Record<LocalTtsEngineId, { url: string; voice: string; cuda: string }>
> = {
  piper: { url: 'piperUrl', voice: 'piperVoice', cuda: 'piperCuda' },
  kokoro: { url: 'kokoroUrl', voice: 'kokoroVoice', cuda: 'kokoroCuda' },
  f5: { url: 'f5Url', voice: 'f5Voice', cuda: 'f5Cuda' }
};
