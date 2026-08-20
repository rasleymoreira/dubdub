/*
 * Namespace compartilhado entre service worker, content scripts e popup.
 * Nao usa `export` de proposito: o mesmo arquivo precisa rodar como modulo
 * (service worker / popup) e como content script classico.
 */
(function (root) {
  'use strict';

  const MSG = {
    // popup -> service worker
    GET_STATE: 'GET_STATE',
    START_JOB: 'START_JOB',
    CANCEL_JOB: 'CANCEL_JOB',
    SET_SETTINGS: 'SET_SETTINGS',
    LIST_DUBS: 'LIST_DUBS',
    DELETE_DUB: 'DELETE_DUB',
    CLEAR_CACHE: 'CLEAR_CACHE',
    SET_ENABLED: 'SET_ENABLED',
    VALIDATE_KEY: 'VALIDATE_KEY',

    // content script -> service worker
    CONTENT_READY: 'CONTENT_READY',
    GET_MANIFEST: 'GET_MANIFEST',
    GET_CLIPS: 'GET_CLIPS',
    PING: 'PING',

    // servidores de TTS local (piper | kokoro)
    LOCAL_TEST: 'LOCAL_TEST',
    LOCAL_START: 'LOCAL_START',
    LOCAL_STOP: 'LOCAL_STOP',
    LOCAL_STATUS: 'LOCAL_STATUS',
    ELEVEN_TEST: 'ELEVEN_TEST',
    INWORLD_TEST: 'INWORLD_TEST',

    // service worker -> content script
    GET_LECTURE_CONTEXT: 'GET_LECTURE_CONTEXT',
    GET_CURRICULUM: 'GET_CURRICULUM',
    GET_TAB_STATE: 'GET_TAB_STATE',
    FETCH_TEXT: 'FETCH_TEXT',
    JOB_PROGRESS: 'JOB_PROGRESS',
    DUB_READY: 'DUB_READY',
    APPLY_SETTINGS: 'APPLY_SETTINGS',
    APPLY_ENABLED: 'APPLY_ENABLED'
  };

  // host de native messaging que liga/desliga o servidor Piper
  const NATIVE_HOST = 'com.udub.piper';

  const STATUS = {
    IDLE: 'idle',
    CONTEXT: 'context',
    TRANSCRIBING: 'transcribing',
    TRANSLATING: 'translating',
    SYNTHESIZING: 'synthesizing',
    DONE: 'done',
    ERROR: 'error',
    CANCELED: 'canceled'
  };

  const STATUS_LABEL = {
    idle: 'Parado',
    context: 'Lendo a aula',
    transcribing: 'Transcrevendo',
    translating: 'Traduzindo',
    synthesizing: 'Gerando voz',
    done: 'Dublagem pronta',
    error: 'Erro',
    canceled: 'Cancelado'
  };

  const DEFAULTS = {
    // preset principal do popup: define stt + tts de uma vez
    provider: 'deepgram', // 'deepgram' | 'google'

    // controles avancados (auto = derivado do preset)
    sttProvider: 'auto', // 'auto' | 'deepgram' | 'captions'
    ttsEngine: 'piper', // 'auto' | 'deepgram' | 'google' | 'piper'

    deepgramApiKey: 'ddd98968ba41b78d4846e96152562966dccd04a3',
    deepgramSttModel: 'nova-3',
    deepgramVoice: 'aura-2-thalia-en',

    f5Url: 'http://localhost:5002',
    f5Voice: 'padrao', // referencia em models/f5-ref (vazio = a primeira que existir)
    f5Cuda: true, // o F5 na CPU e impraticavel

    kokoroUrl: 'http://localhost:5001',
    kokoroVoice: 'pm_alex',
    kokoroCuda: false, // usa a GPU se o torch tiver CUDA (o servidor cai para CPU sozinho)

    piperUrl: 'http://localhost:5000',
    piperVoice: 'pt_BR-faber-medium',
    piperLengthScale: 1, // <1 fala mais rapido, >1 mais devagar
    // --cuda so faz sentido com onnxruntime-gpu instalado; para os modelos
    // medium do Piper a CPU e mais rapida (medido: 38x contra 34x tempo real)
    piperCuda: false,

    elevenApiKey: 'sk_e2de8bb37a00799653570c7ea2510b6ebcc4504a2d491912',
    elevenVoiceId: 'JBFqnCBsd6RMkjVDRZzb', // George
    elevenModel: 'eleven_flash_v2_5',
    elevenFormat: 'mp3_22050_32',

    inworldApiKey:
      'Z1lHQmdfQnJndVc3bHI1WTd5MVhYdjkxaHBpd2RuVlc6NlVqWmJWUDZYUFhkbFZHZl9BYUMyeQ==',
    inworldVoiceId: 'Heitor',
    inworldModel: 'inworld-tts-2',
    inworldBitRate: 64000, // metade do tamanho do mp3 padrao, sem perda audivel

    sourceLang: 'en',
    targetLang: 'pt-BR',

    originalVolume: 0, // volume do audio original enquanto a dublagem toca (0..1)
    dubVolume: 1, // volume da dublagem (0..1)
    maxSpeedup: 1.25, // aceleracao maxima da voz para caber no tempo da fala
    autoEnable: true, // ao abrir uma aula ja dublada, aplica a dublagem sozinho
    autoDub: false, // iniciar dublagem sozinho ao abrir uma aula sem dublagem
    startFromPlayhead: true, // gerar primeiro os trechos a partir do tempo atual
    prefetchNext: 2, // quantas aulas seguintes dublar sozinho depois da atual
    cacheMaxDubs: 8, // quantas aulas ficam no cache antes de descartar a mais antiga
    showOverlay: false // painel flutuante na aula; o popup faz o mesmo sem poluir a tela
  };

  // Idiomas com voz no Deepgram Aura-2 (nao inclui portugues).
  const DEEPGRAM_VOICES = {
    en: [
      'aura-2-thalia-en', 'aura-2-andromeda-en', 'aura-2-apollo-en', 'aura-2-arcas-en',
      'aura-2-asteria-en', 'aura-2-athena-en', 'aura-2-aurora-en', 'aura-2-helena-en',
      'aura-2-hera-en', 'aura-2-luna-en', 'aura-2-orion-en', 'aura-2-orpheus-en',
      'aura-2-selene-en', 'aura-2-theia-en', 'aura-2-zeus-en'
    ],
    es: [
      'aura-2-celeste-es', 'aura-2-estrella-es', 'aura-2-diana-es', 'aura-2-selena-es',
      'aura-2-sirio-es', 'aura-2-nestor-es', 'aura-2-javier-es', 'aura-2-alvaro-es'
    ],
    de: ['aura-2-julius-de'],
    fr: ['aura-2-agathe-fr'],
    nl: ['aura-2-rhea-nl'],
    it: ['aura-2-livia-it'],
    ja: ['aura-2-fujin-ja']
  };

  // Idiomas de destino oferecidos na UI (todos suportados pelo TTS do Google).
  const TARGET_LANGS = [
    { code: 'pt-BR', label: 'Portugues (Brasil)' },
    { code: 'pt-PT', label: 'Portugues (Portugal)' },
    { code: 'es', label: 'Espanhol' },
    { code: 'en', label: 'Ingles' },
    { code: 'fr', label: 'Frances' },
    { code: 'de', label: 'Alemao' },
    { code: 'it', label: 'Italiano' },
    { code: 'ja', label: 'Japones' }
  ];

  // Motores de voz oferecidos na UI, na ordem em que aparecem.
  const TTS_ENGINES = [
    { id: 'kokoro', label: 'Kokoro (local)', hint: 'Voz mais natural que o Piper, offline e sem custo. ~5x tempo real.' },
    { id: 'piper', label: 'Piper (local)', hint: 'A mais rapida (38x tempo real), mas a voz e a mais robotica.' },
    {
      id: 'f5',
      label: 'F5-TTS (local)',
      hint: 'Clona a voz de um audio de referencia. Precisa de GPU e e uso nao comercial.'
    },
    { id: 'inworld', label: 'Inworld', hint: 'Vozes neurais em pt-BR (Heitor, Bruna, Renata...). Cobra por caractere.' },
    { id: 'elevenlabs', label: 'ElevenLabs', hint: 'Melhor qualidade em pt-BR. Consome creditos da conta.' },
    { id: 'google', label: 'Google TTS', hint: 'Sem API key e sem custo. Voz robotica.' },
    { id: 'deepgram', label: 'Deepgram Aura-2', hint: 'Sem voz em portugues (en, es, de, fr, nl, it, ja).' }
  ];

  // Vozes em portugues do Brasil no Kokoro 82M (lang_code 'p').
  const KOKORO_PT_VOICES = [
    { code: 'pm_alex', label: 'Alex — masculina' },
    { code: 'pm_santa', label: 'Santa — masculina, mais grave' },
    { code: 'pf_dora', label: 'Dora — feminina' }
  ];

  // Vozes em portugues do Inworld (a API tem 280+ no total, filtraveis por idioma).
  const INWORLD_PT_VOICES = [
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

  const INWORLD_MODELS = [
    { code: 'inworld-tts-2', label: 'TTS-2 (melhor qualidade)' },
    { code: 'inworld-tts-2-flash', label: 'TTS-2 Flash (mais rapido)' },
    { code: 'inworld-tts-1', label: 'TTS-1' },
    { code: 'inworld-tts-1-max', label: 'TTS-1 Max' }
  ];

  const SOURCE_LANGS = [
    { code: 'en', label: 'Ingles' },
    { code: 'es', label: 'Espanhol' },
    { code: 'fr', label: 'Frances' },
    { code: 'de', label: 'Alemao' },
    { code: 'it', label: 'Italiano' },
    { code: 'auto', label: 'Detectar automaticamente' }
  ];

  /** 'pt-BR' -> 'pt'. Usado para casar idioma com voz do Deepgram. */
  function baseLang(code) {
    return String(code || '').split('-')[0].toLowerCase();
  }

  /** Vozes do Deepgram disponiveis para um idioma de destino. */
  function deepgramVoicesFor(lang) {
    return DEEPGRAM_VOICES[baseLang(lang)] || [];
  }

  /** Hash curto e estavel (FNV-1a) usado em chaves de cache. */
  function hashText(text) {
    let h = 0x811c9dc5;
    const str = String(text);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  /** Idioma que uma voz do Piper fala: 'pt_BR-faber-medium' -> 'pt'. */
  function piperVoiceLang(voice) {
    return String(voice || '').split('-')[0].split('_')[0].toLowerCase();
  }

  /** Chave da dublagem: mesma aula + idioma + motor de voz = mesmo cache. */
  function dubKey({ lectureId, targetLang, ttsEngine, voice }) {
    const voicePart = ttsEngine === 'google' ? 'default' : voice || 'default';
    return [lectureId, targetLang, ttsEngine, voicePart].join('|');
  }

  function transcriptKey({ lectureId, sttProvider, sourceLang }) {
    return [lectureId, sttProvider, sourceLang].join('|');
  }

  /**
   * Resolve o preset em motores concretos, aplicando os limites reais de cada API.
   * O Deepgram nao tem voz em portugues, entao TTS cai para o Google nesse caso.
   */
  function resolveEngines(settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const notes = [];

    let stt = s.sttProvider;
    if (stt === 'auto') stt = s.provider === 'deepgram' ? 'deepgram' : 'captions';
    if (stt === 'deepgram' && !s.deepgramApiKey) {
      stt = 'captions';
      notes.push('Sem API key do Deepgram: usando as legendas da Udemy.');
    }

    let tts = s.ttsEngine;
    if (tts === 'auto') tts = s.provider === 'deepgram' ? 'deepgram' : 'google';

    let voice = null;
    if (tts === 'f5') {
      voice = s.f5Voice;
      if (!voice) notes.push('Sem referencia escolhida: o servidor usa a primeira de models/f5-ref.');
    } else if (tts === 'kokoro') {
      voice = s.kokoroVoice;
      // as vozes pt do Kokoro comecam com 'p' (pm_alex, pf_dora...)
      if (String(voice).startsWith('p') && baseLang(s.targetLang) !== 'pt') {
        notes.push('A voz ' + voice + ' fala portugues, mas o destino e ' + s.targetLang + '.');
      }
    } else if (tts === 'piper') {
      voice = s.piperVoice;
      const spoken = piperVoiceLang(voice);
      if (spoken && spoken !== baseLang(s.targetLang)) {
        notes.push('A voz ' + voice + ' fala ' + spoken + ', mas o destino e ' + s.targetLang + '.');
      }
    } else if (tts === 'inworld') {
      voice = s.inworldVoiceId;
      if (!s.inworldApiKey) {
        tts = 'google';
        voice = null;
        notes.push('Sem API key do Inworld: voz gerada pelo Google TTS.');
      }
    } else if (tts === 'elevenlabs') {
      voice = s.elevenVoiceId;
      if (!s.elevenApiKey) {
        tts = 'google';
        voice = null;
        notes.push('Sem API key do ElevenLabs: voz gerada pelo Google TTS.');
      }
    } else if (tts === 'deepgram') {
      voice = s.deepgramVoice;
      const options = deepgramVoicesFor(s.targetLang);
      if (!options.length) {
        tts = 'google';
        voice = null;
        notes.push('Deepgram nao tem voz em ' + s.targetLang + ': a voz sera gerada pelo Google TTS.');
      } else if (!options.includes(voice)) {
        voice = options[0];
        notes.push('Voz ajustada para ' + voice + ' (compativel com o idioma escolhido).');
      }
      if (tts === 'deepgram' && !s.deepgramApiKey) {
        tts = 'google';
        voice = null;
        notes.push('Sem API key do Deepgram: voz gerada pelo Google TTS.');
      }
    }

    return { sttProvider: stt, ttsEngine: tts, voice, notes };
  }

  root.UDUB = {
    MSG,
    NATIVE_HOST,
    STATUS,
    STATUS_LABEL,
    DEFAULTS,
    DEEPGRAM_VOICES,
    TTS_ENGINES,
    KOKORO_PT_VOICES,
    INWORLD_PT_VOICES,
    INWORLD_MODELS,
    TARGET_LANGS,
    SOURCE_LANGS,
    baseLang,
    deepgramVoicesFor,
    piperVoiceLang,
    hashText,
    dubKey,
    transcriptKey,
    resolveEngines
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
