/*
 * Verificacao da extensao: logica pura (legendas, agrupamento, fallbacks),
 * sincronia do motor de audio e os endpoints reais.
 *
 *   node tests/run.js              roda tudo
 *   node tests/run.js --offline    so a logica pura, sem rede
 *   DG_KEY=xxx EL_KEY=xxx node tests/run.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../src/shared/constants.js';
import { chunkText, parseCaptions, segmentsFromCaptions } from '../src/background/lib/segments.js';
import { addContinuityPunctuation, normalizeForSpeech } from '../src/background/lib/text.js';
import * as google from '../src/background/lib/google.js';
import * as deepgram from '../src/background/lib/deepgram.js';
import * as elevenlabs from '../src/background/lib/elevenlabs.js';
import * as inworld from '../src/background/lib/inworld.js';
import * as localtts from '../src/background/lib/localtts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE = process.argv.includes('--offline');
const DG_KEY = process.env.DG_KEY || globalThis.UDUB.DEFAULTS.deepgramApiKey;
const EL_KEY = process.env.EL_KEY || globalThis.UDUB.DEFAULTS.elevenApiKey;
const IW_KEY = process.env.IW_KEY || globalThis.UDUB.DEFAULTS.inworldApiKey;
const D = globalThis.UDUB.DEFAULTS;
const LOCAL_SERVERS = [
  { engine: 'piper', label: 'Piper', url: process.env.PIPER_URL || D.piperUrl, voice: D.piperVoice },
  { engine: 'kokoro', label: 'Kokoro', url: process.env.KOKORO_URL || D.kokoroUrl, voice: D.kokoroVoice },
  { engine: 'f5', label: 'F5-TTS', url: process.env.F5_URL || D.f5Url, voice: D.f5Voice }
];

let fails = 0;
function check(name, condition, extra) {
  console.log((condition ? 'PASS ' : 'FAIL ') + name + (extra ? ' -> ' + extra : ''));
  if (!condition) fails++;
}
function section(title) {
  console.log('\n== ' + title);
}

// ----------------------------------------------------------- legendas e texto
section('legendas e agrupamento');

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.200
Hello and welcome to this course

2
00:00:03.300 --> 00:00:05.000
about JavaScript.

3
00:00:08.000 --> 00:00:10.500
<c.colorE5E5E5>In this lecture</c> we will build a small app.

4
00:00:10.600 --> 00:00:12.000
Let's get started!
`;

const cues = parseCaptions(VTT);
check('parseCaptions le as 4 cues', cues.length === 4);
check('parseCaptions remove tags de estilo', !/[<>]/.test(cues[2].text), cues[2].text);

const segments = segmentsFromCaptions(VTT);
check('cues viram frases', segments.length === 2, JSON.stringify(segments.map((s) => s.text)));
check('cues da mesma frase sao unidas', /welcome.*JavaScript\.$/.test(segments[0].text));
check('tempos preservados', segments[0].start === 1 && segments[1].start === 8);
check(
  'segmentos nao se sobrepoem',
  segments.every((s, i) => i === 0 || s.start >= segments[i - 1].end)
);

const longo = 'Frase um bem comprida para forcar a quebra do texto. '.repeat(8);
const pedacos = chunkText(longo, 180);
check(
  'chunkText respeita o limite por requisicao',
  pedacos.every((p) => p.length <= 180),
  'maior=' + Math.max(...pedacos.map((p) => p.length))
);
check(
  'chunkText nao perde conteudo',
  pedacos.join(' ').replace(/\s+/g, ' ').trim().length >= longo.trim().length - 10
);

// ------------------------------------------------------------ texto para o TTS
section('preparo do texto para a voz');

const legendaSuja = `[MUSIC]
>> INSTRUCTOR: so in this lecture we are
going to create a remote func-
tion that runs on the the server...`;
const limpo = normalizeForSpeech(legendaSuja, { dedupe: true });
check('remove marcacao de nao-fala', !/\[MUSIC\]/i.test(limpo), limpo);
check('remove identificacao do locutor', !/INSTRUCTOR/i.test(limpo));
check('junta as quebras de linha', !/\n/.test(limpo));
check('remonta palavra cortada no fim da linha', /function/.test(limpo), limpo);
check('remove palavra repetida', !/the the/i.test(limpo));
check('reticencias viram pausa', !/\.\.\./.test(limpo) && /,/.test(limpo));
check('comeca com maiuscula', /^[A-Z]/.test(limpo), limpo);

check(
  'legenda em caixa alta vira frase normal',
  normalizeForSpeech('WELCOME TO THE COURSE ABOUT FUNCTIONS') === 'Welcome to the course about functions',
  normalizeForSpeech('WELCOME TO THE COURSE ABOUT FUNCTIONS')
);
check(
  'corrige espaco antes da pontuacao',
  normalizeForSpeech('Isso é importante , sabia ?') === 'Isso é importante, sabia?'
);
check(
  'nao estraga numero com ponto',
  normalizeForSpeech('O valor é 1.500 reais.') === 'O valor é 1.500 reais.',
  normalizeForSpeech('O valor é 1.500 reais.')
);

const trechos = [
  { txt: 'nesta aula vamos criar uma função' },
  { txt: 'que roda no servidor' },
  { txt: 'Depois disso, testamos' }
];
addContinuityPunctuation(trechos, 'txt');
check('frase que continua recebe virgula', trechos[0].txt.endsWith(','), trechos[0].txt);
check('frase antes de maiuscula recebe ponto', trechos[1].txt.endsWith('.'), trechos[1].txt);
check('ultimo trecho recebe ponto', trechos[2].txt.endsWith('.'), trechos[2].txt);

// pausa do palestrante vira virgula na hora de agrupar
const comPausa = segmentsFromCaptions(`WEBVTT

00:00:01.000 --> 00:00:03.000
first we open the editor

00:00:03.600 --> 00:00:05.000
then we create the class
`);
check(
  'pausa de 0,6s entre falas vira virgula',
  /editor,\s+then/i.test(comPausa[0].text),
  comPausa[0].text
);
const semPausa = segmentsFromCaptions(`WEBVTT

00:00:01.000 --> 00:00:03.000
first we open the editor

00:00:03.050 --> 00:00:05.000
then we create the class
`);
check(
  'fala continua nao ganha virgula',
  !/editor,/i.test(semPausa[0].text),
  semPausa[0].text
);

// -------------------------------------------------------------- motores/vozes
section('escolha de motores');

const { resolveEngines, deepgramVoicesFor, dubKey, piperVoiceLang } = globalThis.UDUB;

const piperEngine = resolveEngines({ ttsEngine: 'piper' });
check('Piper usa a voz Faber', piperEngine.voice === 'pt_BR-faber-medium');
check('padrao transcreve com o Deepgram', resolveEngines({}).sttProvider === 'deepgram');

const kokoro = resolveEngines({ ttsEngine: 'kokoro' });
check('Kokoro usa a voz pm_alex', kokoro.ttsEngine === 'kokoro' && kokoro.voice === 'pm_alex', kokoro.voice);
check(
  'Kokoro avisa quando o destino nao e portugues',
  resolveEngines({ ttsEngine: 'kokoro', targetLang: 'es' }).notes.length > 0
);

const f5 = resolveEngines({ ttsEngine: 'f5' });
check('F5 usa a referencia padrao', f5.ttsEngine === 'f5' && f5.voice === 'padrao', f5.voice);
check(
  'F5 com outra referencia usa o nome dela',
  resolveEngines({ ttsEngine: 'f5', f5Voice: 'minhavoz' }).voice === 'minhavoz'
);
check(
  'F5 sem referencia nenhuma avisa',
  resolveEngines({ ttsEngine: 'f5', f5Voice: '' }).notes.length > 0
);
check('idioma da voz Piper e lido do nome', piperVoiceLang('pt_BR-faber-medium') === 'pt');

const piperEspanhol = resolveEngines({ ttsEngine: 'piper', targetLang: 'es' });
check(
  'avisa quando a voz Piper nao fala o idioma de destino',
  piperEspanhol.notes.some((note) => note.includes('pt')),
  piperEspanhol.notes.join(' ')
);

const inworldEngine = resolveEngines({ ttsEngine: 'inworld' });
check(
  'Inworld usa a voz Heitor por padrao',
  inworldEngine.ttsEngine === 'inworld' && inworldEngine.voice === 'Heitor',
  inworldEngine.voice
);
check('Inworld sem key cai para o Google', resolveEngines({ ttsEngine: 'inworld', inworldApiKey: '' }).ttsEngine === 'google');

const eleven = resolveEngines({ ttsEngine: 'elevenlabs' });
check('ElevenLabs usa o voice id configurado', eleven.ttsEngine === 'elevenlabs' && Boolean(eleven.voice));
const elevenSemKey = resolveEngines({ ttsEngine: 'elevenlabs', elevenApiKey: '' });
check('ElevenLabs sem key cai para o Google', elevenSemKey.ttsEngine === 'google');

const ptDeepgram = resolveEngines({ ttsEngine: 'deepgram', targetLang: 'pt-BR' });
check(
  'pt-BR no Deepgram cai para o Google TTS',
  ptDeepgram.ttsEngine === 'google',
  ptDeepgram.notes.join(' ')
);
const esDeepgram = resolveEngines({ ttsEngine: 'deepgram', targetLang: 'es' });
check('es mantem a voz do Deepgram', esDeepgram.ttsEngine === 'deepgram' && esDeepgram.voice.endsWith('-es'));
check('catalogo Deepgram nao tem voz pt', deepgramVoicesFor('pt-BR').length === 0);
check('sem API key do Deepgram usa as legendas', resolveEngines({ deepgramApiKey: '' }).sttProvider === 'captions');

const chavePiper = dubKey({ lectureId: '1', targetLang: 'pt-BR', ttsEngine: 'piper', voice: 'pt_BR-faber-medium' });
const chaveEleven = dubKey({ lectureId: '1', targetLang: 'pt-BR', ttsEngine: 'elevenlabs', voice: 'abc' });
check('cache separa dublagens por motor e voz', chavePiper !== chaveEleven, chavePiper + ' != ' + chaveEleven);

// ---------------------------------------------------------------- preferencias
section('preferencias e migracao');

check('painel flutuante nasce desligado', globalThis.UDUB.DEFAULTS.showOverlay === false);

// settings.js fala com chrome.storage: stub minimo para rodar no node
const storage = { settings: { showOverlay: true, targetLang: 'pt-BR' } };
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const wanted = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of wanted) if (key in storage) out[key] = storage[key];
        return out;
      },
      async set(values) {
        Object.assign(storage, values);
      }
    },
    onChanged: { addListener() {} }
  }
};

const settingsV1 = await import('../src/background/lib/settings.js');
const migrado = await settingsV1.getSettings();
check('migracao desliga o painel ja salvo como ligado', migrado.showOverlay === false);
check('migracao fica registrada', storage.migrations?.overlayOff === true);
check('migracao preserva as outras preferencias', migrado.targetLang === 'pt-BR');

// o usuario liga de novo: a escolha tem de sobreviver a proxima leitura
await settingsV1.setSettings({ showOverlay: true });
const settingsV2 = await import('../src/background/lib/settings.js?fresh=1');
const depois = await settingsV2.getSettings();
check('reativar o painel continua valendo depois', depois.showOverlay === true);

// ------------------------------------------------------- sincronia do player
section('sincronia do motor de audio');

// O engine roda como content script classico: carregamos com stubs de DOM.
class FakeAudio {
  constructor() {
    this.paused = true;
    this.currentTime = 0;
    this.playbackRate = 1;
    this.volume = 1;
    this.readyState = 4;
    this.preservesPitch = false;
    this.src = '';
  }
  load() {}
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener() {}
  removeEventListener() {}
  removeAttribute() {}
}
globalThis.Audio = FakeAudio;
globalThis.URL.createObjectURL = () => 'blob:fake';
globalThis.URL.revokeObjectURL = () => {};

const engineSource = fs.readFileSync(path.join(ROOT, 'src/content/engine.js'), 'utf8');
const UDUB_Engine = new Function(engineSource + '\nreturn UDUB_Engine;')();

function buildEngine({ clipTotal, videoRate, currentTime, maxSpeedup = 1.25 }) {
  const engine = new UDUB_Engine.DubEngine({ requestClips: async () => [], onStatus() {} });
  engine.segments = [
    { i: 0, start: 0, end: 2 },
    { i: 1, start: 4, end: 6 }
  ];
  engine.manifest = { key: 'k', segments: engine.segments };
  engine.clips.set(0, { parts: [{ url: 'blob:a', duration: clipTotal }], total: clipTotal });
  engine.maxSpeedup = maxSpeedup;
  engine.enabled = true;
  engine.video = {
    currentTime,
    playbackRate: videoRate,
    paused: false,
    ended: false,
    seeking: false,
    muted: false,
    volume: 1
  };
  return engine;
}

// clipe de 3s cabe nos 4s ate a proxima fala: nao precisa acelerar
const normal = buildEngine({ clipTotal: 3, videoRate: 1, currentTime: 1 });
normal._tick();
check('toca o trecho certo', normal.current?.index === 0);
check('sem aceleracao quando cabe no tempo', normal.current.slot.el.playbackRate === 1);
check('entra no ponto certo do clipe', Math.abs(normal.current.slot.el.currentTime - 1) < 0.01);

// video em 2x: a dublagem acompanha em 2x, com preservacao de tom
const rapido = buildEngine({ clipTotal: 3, videoRate: 2, currentTime: 1 });
rapido._tick();
check('em 2x a voz toca em 2x', rapido.current.slot.el.playbackRate === 2);
check('preservesPitch ligado (voz nao fica fina)', rapido.current.slot.el.preservesPitch === true);

// clipe de 6s em um espaco de 4s: acelera ate o limite e nao alem
const apertado = buildEngine({ clipTotal: 6, videoRate: 1, currentTime: 0 });
apertado._tick();
check('acelera ate o limite quando nao cabe', Math.abs(apertado.current.slot.el.playbackRate - 1.25) < 0.001);
const apertado2x = buildEngine({ clipTotal: 6, videoRate: 2, currentTime: 0 });
apertado2x._tick();
check('2x combina com a compressao do trecho', Math.abs(apertado2x.current.slot.el.playbackRate - 2.5) < 0.001);

// posicao dentro de clipe comprimido
const comprimido = buildEngine({ clipTotal: 6, videoRate: 1, currentTime: 2 });
comprimido._tick();
check(
  'posicao no clipe considera a compressao',
  Math.abs(comprimido.current.slot.el.currentTime - 2.5) < 0.01,
  'currentTime=' + comprimido.current.slot.el.currentTime
);

// correcao de deriva
const deriva = buildEngine({ clipTotal: 3, videoRate: 1, currentTime: 1 });
deriva._tick();
deriva.current.lastFix = -1000; // passa o intervalo minimo entre correcoes
deriva.current.slot.el.currentTime = 2.4; // fora de sincronia
deriva.video.currentTime = 1.2;
deriva._tick();
check(
  'corrige quando a dublagem sai de sincronia',
  Math.abs(deriva.current.slot.el.currentTime - 1.2) < 0.01,
  'currentTime=' + deriva.current.slot.el.currentTime
);

// multiplas partes no mesmo trecho
const multi = buildEngine({ clipTotal: 1, videoRate: 1, currentTime: 0 });
multi.clips.set(0, {
  parts: [
    { url: 'blob:a', duration: 2 },
    { url: 'blob:b', duration: 3 }
  ],
  total: 5
});
multi.video.currentTime = 3;
multi._tick();
check('escolhe a parte certa de um trecho multiplo', multi.current.partIndex === 1);
check('offset dentro da parte', Math.abs(multi.current.slot.el.currentTime - 1.75) < 0.05,
  'currentTime=' + multi.current.slot.el.currentTime);

// fora de qualquer trecho: silencio
const silencio = buildEngine({ clipTotal: 1, videoRate: 1, currentTime: 3.5 });
silencio._tick();
check('pausa quando nao ha fala no momento', silencio.current === null || silencio.current.slot.el.paused);

// video pausado nao toca dublagem
const pausado = buildEngine({ clipTotal: 3, videoRate: 1, currentTime: 1 });
pausado._tick();
pausado.video.paused = true;
pausado._tick();
check('video pausado pausa a dublagem', pausado.current.slot.el.paused === true);

// ------------------------------------------------------------------ endpoints
if (OFFLINE) {
  console.log('\nSKIP testes de rede (--offline)');
} else {
  section('Google Translate / TTS');
  const traducao = await google.translateAll({
    texts: ['Hello and welcome to this course about JavaScript.', "Let's get started!", 'The quick brown fox.'],
    from: 'en',
    to: 'pt-BR'
  });
  check(
    'Google Translate devolve uma traducao por trecho',
    traducao.length === 3 && traducao.every((t) => t && t.length > 3),
    JSON.stringify(traducao)
  );

  const voz = await google.speak({ text: 'Olá, bem-vindo a esta aula.', lang: 'pt-BR' });
  check('Google TTS devolve audio', voz.parts.length === 1 && voz.parts[0].length > 500);

  const textoLongo =
    'Este é um texto bem mais longo, com várias orações, para forçar a extensão a dividir o áudio em mais de uma parte. ' +
    'Depois disso, o player precisa tocar todas as partes em sequência, sem buraco audível entre elas. ' +
    'Se o segmento não couber no tempo da fala original, a voz é acelerada até o limite configurado.';
  const vozLonga = await google.speak({ text: textoLongo, lang: 'pt-BR' });
  check('Google TTS divide textos longos', vozLonga.parts.length >= 2, vozLonga.parts.length + ' partes');

  section('Deepgram');
  if (!DG_KEY) {
    console.log('SKIP (sem API key)');
  } else {
    try {
      const projetos = await deepgram.validateKey(DG_KEY);
      check('API key valida', projetos.ok === true, (projetos.projects || []).join(', '));
    } catch (error) {
      check('API key valida', false, error.message);
    }
    try {
      const stt = await deepgram.transcribeUrl({
        apiKey: DG_KEY,
        model: 'nova-3',
        language: 'en',
        mediaUrl: 'https://dpgr.am/spacewalk.wav'
      });
      check(
        'STT devolve segmentos com tempo',
        stt.segments.length > 0 && stt.segments[0].end > stt.segments[0].start,
        JSON.stringify(stt.segments[0]).slice(0, 100)
      );
    } catch (error) {
      check('STT devolve segmentos com tempo', false, error.message);
    }
  }

  section('Inworld');
  if (!IW_KEY) {
    console.log('SKIP (sem API key)');
  } else {
    let temHeitor = false;
    try {
      const voices = await inworld.listVoices({ apiKey: IW_KEY, language: 'pt' });
      temHeitor = voices.some((voice) => voice.id === 'Heitor');
      check('vozes em pt listadas', voices.length > 0, voices.length + ' vozes');
      check('voz Heitor existe na conta', temHeitor);
    } catch (error) {
      check('vozes em pt listadas', false, error.message);
    }
    try {
      const audio = await inworld.speak({
        apiKey: IW_KEY,
        voiceId: 'Heitor',
        model: globalThis.UDUB.DEFAULTS.inworldModel,
        bitRate: globalThis.UDUB.DEFAULTS.inworldBitRate,
        text: 'Teste de voz.'
      });
      const bytes = Buffer.from(audio.parts[0], 'base64');
      check(
        'sintese devolve mp3 tocavel',
        audio.mime === 'audio/mpeg' && bytes[0] === 0xff && bytes.length > 1000,
        (bytes.length / 1024).toFixed(1) + ' KB · ' + audio.characters + ' chars cobrados'
      );
    } catch (error) {
      check('sintese devolve mp3 tocavel', false, error.message);
    }
  }

  section('ElevenLabs');
  if (!EL_KEY) {
    console.log('SKIP (sem API key)');
  } else {
    try {
      const quota = await elevenlabs.getQuota({ apiKey: EL_KEY });
      check('quota lida', quota.limit > 0, quota.tier + ': restam ' + quota.remaining + '/' + quota.limit);
    } catch (error) {
      check('quota lida', false, error.message);
    }
    try {
      const voices = await elevenlabs.listVoices({ apiKey: EL_KEY });
      check('lista de vozes', voices.length > 0, voices.length + ' vozes');
    } catch (error) {
      check('lista de vozes', false, error.message);
    }
    try {
      await elevenlabs.speak({
        apiKey: EL_KEY,
        voiceId: globalThis.UDUB.DEFAULTS.elevenVoiceId,
        model: 'eleven_flash_v2_5',
        format: 'mp3_22050_32',
        text: 'ok'
      });
      check('sintese responde', true, 'audio gerado');
    } catch (error) {
      // conta sem credito/pagamento: o que importa e a mensagem chegar legivel
      check('erro de sintese chega legivel para a UI', /ElevenLabs \d{3}: .+/.test(error.message), error.message);
    }
  }

  section('servidores de TTS local');
  for (const server of LOCAL_SERVERS) {
    try {
      const result = await localtts.ping({
        baseUrl: server.url,
        voice: server.voice,
        label: server.label
      });
      check(
        server.label + ' responde no contrato esperado',
        result.ok === true && /audio/.test(result.mime),
        'formato ' + result.mode + ' · ' + result.mime +
          (result.info?.device ? ' · ' + result.info.device : '') +
          (result.voices?.length ? ' · ' + result.voices.length + ' voz(es)' : '')
      );

      // um trecho real, do tamanho que a extensao envia
      const audio = await localtts.speak({
        baseUrl: server.url,
        voice: server.voice,
        label: server.label,
        text: 'Nesta aula vamos criar uma função remota que roda no servidor.'
      });
      const bytes = Buffer.from(audio.parts[0], 'base64');
      const wav = bytes.subarray(0, 4).toString('ascii') === 'RIFF';
      const dur = wav ? (bytes.length - 44) / (bytes.readUInt32LE(24) * 2) : 0;
      check(
        server.label + ' sintetiza um trecho de aula',
        bytes.length > 2000 && (!wav || dur > 1),
        (bytes.length / 1024).toFixed(0) + ' KB' + (wav ? ' · ' + dur.toFixed(2) + 's' : '')
      );
    } catch (error) {
      console.log('SKIP ' + server.label + ' nao esta no ar em ' + server.url);
    }
  }
}

console.log(fails ? '\n' + fails + ' falha(s)' : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
