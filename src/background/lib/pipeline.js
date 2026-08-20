/*
 * Orquestracao da dublagem: transcricao -> traducao -> voz -> cache.
 * Cada etapa e cacheada separadamente, entao trocar a voz nao refaz a
 * transcricao e trocar o idioma nao refaz a leitura das legendas.
 */

import '../../shared/constants.js';
import * as db from './db.js';
import * as deepgram from './deepgram.js';
import * as elevenlabs from './elevenlabs.js';
import * as google from './google.js';
import * as inworld from './inworld.js';
import * as localtts from './localtts.js';
import { segmentsFromCaptions } from './segments.js';
import { normalizeForSpeech, polishForSpeech } from './text.js';
import { CanceledError, mapLimit } from './queue.js';

const { STATUS, dubKey, transcriptKey, hashText, resolveEngines, baseLang } = globalThis.UDUB;

const TTS_CONCURRENCY = { deepgram: 4, elevenlabs: 3, inworld: 3, piper: 2, kokoro: 2, f5: 1, google: 2 };

/** Servidores locais: mesma interface, so muda a URL e o rotulo do erro. */
const LOCAL_ENGINES = {
  piper: { label: 'Piper', url: 'piperUrl', voice: 'piperVoice', script: 'tools\\start-piper.ps1' },
  kokoro: { label: 'Kokoro', url: 'kokoroUrl', voice: 'kokoroVoice', script: 'tools\\kokoro_server.py' },
  f5: { label: 'F5-TTS', url: 'f5Url', voice: 'f5Voice', script: 'tools\\install-f5.ps1' }
};
const CLIP_FLUSH_EVERY = 8;

/** Uma chamada de TTS, no motor escolhido. */
function synthesize({ engines, settings, text, token }) {
  switch (engines.ttsEngine) {
    case 'deepgram':
      return deepgram.speak({ apiKey: settings.deepgramApiKey, model: engines.voice, text, token });
    case 'piper':
      return localtts.speak({
        baseUrl: settings.piperUrl,
        voice: engines.voice,
        lengthScale: settings.piperLengthScale,
        label: 'Piper',
        text,
        token
      });
    case 'kokoro':
      return localtts.speak({
        baseUrl: settings.kokoroUrl,
        voice: engines.voice,
        label: 'Kokoro',
        text,
        token
      });
    case 'f5':
      return localtts.speak({
        baseUrl: settings.f5Url,
        voice: engines.voice,
        label: 'F5-TTS',
        text,
        token
      });
    case 'inworld':
      return inworld.speak({
        apiKey: settings.inworldApiKey,
        voiceId: engines.voice,
        model: settings.inworldModel,
        bitRate: settings.inworldBitRate,
        text,
        token
      });
    case 'elevenlabs':
      return elevenlabs.speak({
        apiKey: settings.elevenApiKey,
        voiceId: engines.voice,
        model: settings.elevenModel,
        format: settings.elevenFormat,
        text,
        token
      });
    default:
      return google.speak({ text, lang: settings.targetLang, token });
  }
}

/**
 * Falha cedo (e com mensagem util) quando o motor de voz nao esta disponivel:
 * servidor Piper apagado, credito do ElevenLabs no fim, etc.
 */
async function preflight({ engines, settings, neededChars, notes }) {
  const local = LOCAL_ENGINES[engines.ttsEngine];
  if (local) {
    const baseUrl = settings[local.url];
    try {
      const result = await localtts.ping({ baseUrl, voice: engines.voice, label: local.label });
      // o servidor do Kokoro informa se caiu para CPU quando a GPU foi pedida
      if (result.info?.device) notes.push(local.label + ' rodando em ' + result.info.device + '.');
    } catch (error) {
      throw new Error(
        local.label +
          ' nao respondeu em ' +
          baseUrl +
          '. Clique em "Ligar servidor" nos ajustes do popup (ou rode ' +
          local.script +
          '). Detalhe: ' +
          error.message
      );
    }
  }

  if (engines.ttsEngine === 'inworld') {
    await inworld.preflight({
      apiKey: settings.inworldApiKey,
      voiceId: engines.voice,
      language: baseLang(settings.targetLang),
      notes
    });
  }

  if (engines.ttsEngine === 'elevenlabs') {
    const result = await elevenlabs.preflight({
      apiKey: settings.elevenApiKey,
      voiceId: engines.voice,
      neededChars
    });
    notes.push(...result.notes);
  }
}

/** Mantem o cache com no maximo `max` aulas, descartando as mais antigas. */
export async function enforceCacheLimit(max) {
  const limit = Number(max) || 0;
  if (limit <= 0) return [];
  const all = await db.getAll(db.STORE.DUBS);
  if (all.length <= limit) return [];
  const excess = all.sort((a, b) => b.updatedAt - a.updatedAt).slice(limit);
  for (const dub of excess) await db.deleteDub(dub.key);
  return excess.map((dub) => dub.key);
}

/** Pede ao content script que baixe um texto (fallback de CORS/cookies). */
async function fetchTextViaTab(tabId, url) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: globalThis.UDUB.MSG.FETCH_TEXT,
    url
  });
  if (!response?.ok) throw new Error(response?.error || 'Falha ao baixar pela aba');
  return response.text;
}

async function fetchCaptionText(tabId, url) {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.text();
  } catch (error) {
    return fetchTextViaTab(tabId, url);
  }
}

/** Escolhe a legenda do idioma de origem (prefere ingles quando em auto). */
function pickCaption(captions, sourceLang) {
  const list = Array.isArray(captions) ? captions.filter((c) => c && c.url) : [];
  if (!list.length) return null;
  const wanted = sourceLang === 'auto' ? 'en' : baseLang(sourceLang);
  return (
    list.find((c) => baseLang(c.locale) === wanted) ||
    list.find((c) => baseLang(c.locale) === 'en') ||
    list[0]
  );
}

/** Menor mp4 disponivel: o audio e o mesmo e o Deepgram baixa menos bytes. */
function pickMediaSource(mediaSources) {
  const list = (mediaSources || []).filter((m) => m && m.src && /mp4/i.test(m.type || m.src));
  if (!list.length) return null;
  const score = (item) => Number(String(item.label || '').replace(/\D/g, '')) || 9999;
  return list.slice().sort((a, b) => score(a) - score(b))[0];
}

async function buildTranscript({ lecture, settings, engines, tabId, emit, token }) {
  const tKey = transcriptKey({
    lectureId: lecture.lectureId,
    sttProvider: engines.sttProvider,
    sourceLang: settings.sourceLang
  });

  // a normalizacao roda tambem no cache: transcricoes antigas se beneficiam
  // das melhorias de texto sem precisar transcrever de novo
  const clean = (segments) =>
    segments
      .map((segment) => ({ ...segment, text: normalizeForSpeech(segment.text, { dedupe: true }) }))
      .filter((segment) => segment.text);

  const cached = await db.get(db.STORE.TRANSCRIPTS, tKey);
  if (cached?.segments?.length) {
    return { segments: clean(cached.segments), source: cached.source, cached: true };
  }

  emit({ status: STATUS.TRANSCRIBING, message: 'Obtendo o texto original' });

  const notes = [];
  let segments = [];
  let source = engines.sttProvider;

  if (engines.sttProvider === 'deepgram') {
    const media = pickMediaSource(lecture.mediaSources);
    if (media) {
      emit({ status: STATUS.TRANSCRIBING, message: 'Transcrevendo o audio com o Deepgram' });
      const result = await deepgram.transcribeUrl({
        apiKey: settings.deepgramApiKey,
        model: settings.deepgramSttModel,
        language: settings.sourceLang,
        mediaUrl: media.src,
        token
      });
      segments = result.segments;
      source = 'deepgram:' + (settings.deepgramSttModel || 'nova-3');
    } else {
      notes.push('Video sem arquivo mp4 acessivel (DRM): usando as legendas da Udemy.');
    }
  }

  if (!segments.length) {
    const caption = pickCaption(lecture.captions, settings.sourceLang);
    if (caption) {
      emit({ status: STATUS.TRANSCRIBING, message: 'Lendo as legendas da aula' });
      const vtt = await fetchCaptionText(tabId, caption.url);
      segments = segmentsFromCaptions(vtt);
      source = 'captions:' + (caption.locale || '?');
    } else if (lecture.localCues?.length) {
      segments = segmentsFromCaptions(lecture.localCues.map(cueToVtt).join('\n'));
      source = 'captions:player';
    }
  }

  if (!segments.length) {
    throw new Error(
      'Nao encontrei legendas nem audio acessivel nesta aula. Ative as legendas em ingles no player e tente de novo.'
    );
  }

  await db.put(db.STORE.TRANSCRIPTS, {
    key: tKey,
    lectureId: lecture.lectureId,
    segments,
    source,
    createdAt: Date.now()
  });

  return { segments: clean(segments), source, notes };
}

function cueToVtt(cue, index) {
  const stamp = (value) => {
    const total = Math.max(0, Number(value) || 0);
    const hours = String(Math.floor(total / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const seconds = String(Math.floor(total % 60)).padStart(2, '0');
    const ms = String(Math.round((total % 1) * 1000)).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
  };
  return `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`;
}

async function translateSegments({ segments, settings, emit, token }) {
  const target = settings.targetLang;
  const cacheKeys = segments.map((s) => target + '|' + hashText(s.text));
  const cachedRows = await Promise.all(cacheKeys.map((key) => db.get(db.STORE.TRANSLATIONS, key)));

  const pending = [];
  const translations = segments.map((segment, index) => {
    const hit = cachedRows[index];
    if (hit?.text) return hit.text;
    pending.push(index);
    return null;
  });

  if (!pending.length) return translations;

  emit({
    status: STATUS.TRANSLATING,
    done: 0,
    total: pending.length,
    message: 'Traduzindo ' + pending.length + ' trechos'
  });

  const results = await google.translateAll({
    texts: pending.map((index) => segments[index].text),
    from: settings.sourceLang,
    to: target,
    token,
    onProgress: (done, total) =>
      emit({ status: STATUS.TRANSLATING, done, total, message: 'Traduzindo trechos' })
  });

  await Promise.all(
    pending.map((segmentIndex, position) => {
      const text = results[position] || segments[segmentIndex].text;
      translations[segmentIndex] = text;
      return db.put(db.STORE.TRANSLATIONS, {
        key: cacheKeys[segmentIndex],
        text,
        createdAt: Date.now()
      });
    })
  );

  return translations;
}

/** Ordem de sintese: do tempo atual pra frente, depois o que ficou atras. */
function synthesisOrder(segments, startAt, enabled) {
  const indexes = segments.map((_, index) => index);
  if (!enabled || !startAt) return indexes;
  const ahead = indexes.filter((i) => segments[i].end >= startAt);
  const behind = indexes.filter((i) => segments[i].end < startAt);
  return ahead.concat(behind);
}

export async function runJob({ tabId, lecture, settings, startAt, force, emit, token }) {
  const engines = resolveEngines(settings);
  const key = dubKey({
    lectureId: lecture.lectureId,
    targetLang: settings.targetLang,
    ttsEngine: engines.ttsEngine,
    voice: engines.voice
  });

  const notes = engines.notes.slice();
  const report = (patch) => emit(Object.assign({ key, notes }, patch));

  report({ status: STATUS.CONTEXT, message: 'Preparando' });

  const transcript = await buildTranscript({ lecture, settings, engines, tabId, emit: report, token });
  if (transcript.notes) notes.push(...transcript.notes);
  token.check();

  const translations = await translateSegments({
    segments: transcript.segments,
    settings,
    emit: report,
    token
  });
  token.check();

  const segments = transcript.segments.map((segment, index) => ({
    i: index,
    start: Number(segment.start.toFixed(3)),
    end: Number(segment.end.toFixed(3)),
    src: segment.text,
    txt: translations[index] || segment.text
  }));

  // texto que vai para o sintetizador: frase corrida e pontuada
  polishForSpeech(segments, 'txt');

  const existing = await db.get(db.STORE.DUBS, key);
  const sameContent =
    existing &&
    existing.segments?.length === segments.length &&
    existing.segments.every((segment, index) => segment.txt === segments[index].txt);

  if (force || !sameContent) {
    if (existing) await db.deleteDub(key);
  }

  const dub = {
    key,
    lectureId: lecture.lectureId,
    courseId: lecture.courseId,
    title: lecture.title || '',
    url: lecture.url || '',
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    sttProvider: engines.sttProvider,
    ttsEngine: engines.ttsEngine,
    voice: engines.ttsEngine === 'deepgram' ? engines.voice : null,
    transcriptSource: transcript.source,
    segments,
    total: segments.length,
    ready: 0,
    status: STATUS.SYNTHESIZING,
    notes,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  await db.put(db.STORE.DUBS, dub);

  const done = force || !sameContent ? new Set() : await db.getClipIndexes(key);
  dub.ready = done.size;

  const pendingChars = segments
    .filter((segment) => !done.has(segment.i))
    .reduce((total, segment) => total + segment.txt.length, 0);
  await preflight({ engines, settings, neededChars: pendingChars, notes });
  token.check();

  report({
    status: STATUS.SYNTHESIZING,
    done: done.size,
    total: segments.length,
    message: 'Gerando a voz em ' + settings.targetLang,
    ready: true
  });

  const order = synthesisOrder(segments, startAt, settings.startFromPlayhead).filter(
    (index) => !done.has(index)
  );
  const concurrency = TTS_CONCURRENCY[engines.ttsEngine] || 2;
  let sinceFlush = 0;
  let failures = 0;

  await mapLimit(
    order,
    concurrency,
    async (index) => {
      token.check();
      const segment = segments[index];
      try {
        const clip = await synthesize({ engines, settings, text: segment.txt, token });

        await db.putClip(key, index, {
          parts: clip.parts,
          mime: clip.mime,
          start: segment.start,
          end: segment.end
        });
        done.add(index);
      } catch (error) {
        if (error instanceof CanceledError) throw error;
        failures++;
        console.warn('[udub] falha no trecho', index, error);
      }

      sinceFlush++;
      dub.ready = done.size;
      if (sinceFlush >= CLIP_FLUSH_EVERY) {
        sinceFlush = 0;
        dub.updatedAt = Date.now();
        await db.put(db.STORE.DUBS, dub);
      }
      report({
        status: STATUS.SYNTHESIZING,
        done: done.size,
        total: segments.length,
        failures,
        message: 'Gerando a voz'
      });
    },
    token
  );

  if (failures) notes.push(failures + ' trecho(s) sem audio (falha na API).');

  dub.ready = done.size;
  dub.status = STATUS.DONE;
  dub.notes = notes;
  dub.updatedAt = Date.now();
  await db.put(db.STORE.DUBS, dub);
  await enforceCacheLimit(settings.cacheMaxDubs);

  report({ status: STATUS.DONE, done: done.size, total: segments.length, failures });
  return dub;
}

/** Manifesto enviado ao player: segmentos sem o audio (que vai por demanda). */
export async function getManifest(key) {
  const dub = await db.get(db.STORE.DUBS, key);
  if (!dub) return null;
  return {
    key: dub.key,
    lectureId: dub.lectureId,
    title: dub.title,
    targetLang: dub.targetLang,
    ttsEngine: dub.ttsEngine,
    voice: dub.voice,
    sttProvider: dub.sttProvider,
    status: dub.status,
    total: dub.total,
    ready: dub.ready,
    notes: dub.notes || [],
    segments: dub.segments.map((s) => ({ i: s.i, start: s.start, end: s.end, txt: s.txt })),
    updatedAt: dub.updatedAt
  };
}

/** Dublagem existente para a aula, considerando as preferencias atuais. */
export async function findDubForLecture(lectureId, settings) {
  const engines = resolveEngines(settings);
  const preferred = dubKey({
    lectureId,
    targetLang: settings.targetLang,
    ttsEngine: engines.ttsEngine,
    voice: engines.voice
  });
  const direct = await getManifest(preferred);
  if (direct) return direct;

  const all = await db.getAll(db.STORE.DUBS);
  const candidate = all
    .filter((dub) => String(dub.lectureId) === String(lectureId) && dub.ready > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return candidate ? getManifest(candidate.key) : null;
}
