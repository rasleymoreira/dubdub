/*
 * Preferencias padrao.
 *
 * ATENCAO AS CREDENCIAIS: os tres campos de API key nascem VAZIOS e assim devem
 * permanecer. A versao anterior trazia chaves reais e funcionais de Deepgram,
 * ElevenLabs e Inworld no codigo-fonte, o que expunha a conta de quem publicasse
 * ou compartilhasse o projeto.
 *
 * A extensao continua util sem credencial nenhuma: legendas da Udemy para o
 * texto, Google Translate para a traducao e Piper, Kokoro, F5 ou Google TTS
 * para a voz. As chaves so habilitam os motores pagos.
 */

import type { Settings } from '../../application/dto/Settings.ts';

export const DEFAULT_SETTINGS: Settings = {
  // preset principal do popup: define stt e tts de uma vez
  provider: 'google',
  sttProvider: 'auto',
  ttsEngine: 'piper',

  sourceLang: 'en',
  targetLang: 'pt-BR',

  deepgramApiKey: '',
  deepgramSttModel: 'nova-3',
  deepgramVoice: 'aura-2-thalia-en',

  elevenApiKey: '',
  elevenVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
  elevenModel: 'eleven_flash_v2_5',
  elevenFormat: 'mp3_22050_32',

  inworldApiKey: '',
  inworldVoiceId: 'Heitor',
  inworldModel: 'inworld-tts-2',
  // metade do tamanho do mp3 padrao, sem perda audivel
  inworldBitRate: 64000,

  piperUrl: 'http://localhost:5000',
  piperVoice: 'pt_BR-faber-medium',
  // menor que 1 fala mais rapido, maior fala mais devagar
  piperLengthScale: 1,
  // --cuda so faz sentido com onnxruntime-gpu; nos modelos medium do Piper a
  // CPU e mais rapida (medido: 38x contra 34x tempo real)
  piperCuda: false,

  kokoroUrl: 'http://localhost:5001',
  kokoroVoice: 'pm_alex',
  kokoroCuda: false,

  f5Url: 'http://localhost:5002',
  // referencia em models/f5-ref; vazio faz o servidor usar a primeira que achar
  f5Voice: 'padrao',
  // o F5 na CPU e impraticavel para uma aula inteira
  f5Cuda: true,

  originalVolume: 0,
  dubVolume: 1,
  maxSpeedup: 1.25,

  autoEnable: true,
  autoDub: false,
  startFromPlayhead: true,
  prefetchNext: 2,
  cacheMaxDubs: 8,
  // o popup faz o mesmo sem poluir a tela da aula
  showOverlay: false
};
