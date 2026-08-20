/*
 * Service worker: roteia mensagens do popup e do content script, controla os
 * jobs de dublagem (inclusive a fila que adianta as proximas aulas) e serve o
 * audio ja gerado para o player.
 */

import '../shared/constants.js';
import * as db from './lib/db.js';
import * as deepgram from './lib/deepgram.js';
import * as elevenlabs from './lib/elevenlabs.js';
import * as inworld from './lib/inworld.js';
import * as localtts from './lib/localtts.js';
import { enforceCacheLimit, findDubForLecture, getManifest, runJob } from './lib/pipeline.js';
import { CancelToken, CanceledError } from './lib/queue.js';
import { getSettings, setSettings } from './lib/settings.js';

const { MSG, NATIVE_HOST, STATUS, dubKey, resolveEngines } = globalThis.UDUB;

/**
 * Fala com o host local que liga/desliga o Piper. A extensao nao pode iniciar
 * processos sozinha: quem faz isso e o native messaging host registrado por
 * tools/install-native-host.ps1.
 */
function nativeSend(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
        const failure = chrome.runtime.lastError;
        if (failure) {
          resolve({
            ok: false,
            missing: /not found|Access to the specified native messaging host/i.test(failure.message || ''),
            error: failure.message || 'host indisponivel'
          });
          return;
        }
        resolve(response || { ok: false, error: 'sem resposta do host' });
      });
    } catch (error) {
      resolve({ ok: false, error: String(error?.message || error) });
    }
  });
}

/** Motores de TTS que rodam em servidor local, com suas preferencias. */
const LOCAL_TTS = {
  piper: { label: 'Piper', url: 'piperUrl', voice: 'piperVoice', cuda: 'piperCuda', port: 5000 },
  kokoro: { label: 'Kokoro', url: 'kokoroUrl', voice: 'kokoroVoice', cuda: 'kokoroCuda', port: 5001 },
  f5: { label: 'F5-TTS', url: 'f5Url', voice: 'f5Voice', cuda: 'f5Cuda', port: 5002 }
};

/** Resolve engine + URL + porta + voz a partir das preferencias. */
function localConfig(settings, requested) {
  const engine = LOCAL_TTS[requested] ? requested : 'piper';
  const cfg = LOCAL_TTS[engine];
  const baseUrl = settings[cfg.url];
  let port = cfg.port;
  try {
    port = Number(new URL(baseUrl).port) || cfg.port;
  } catch {
    /* URL invalida: fica a porta padrao */
  }
  return {
    engine,
    label: cfg.label,
    baseUrl,
    port,
    voice: settings[cfg.voice],
    cuda: Boolean(settings[cfg.cuda])
  };
}

/** tabId -> contexto da aula aberta, reportado pelo content script. */
const tabLectures = new Map();
/** tabId -> job em andamento (um por aba). */
const jobs = new Map();
/** tabId -> ultimo progresso, para o popup reabrir e ver o estado. */
const lastProgress = new Map();

function notifyTab(tabId, message) {
  if (!tabId) return Promise.resolve(null);
  return chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

function notifyPopup(message) {
  return chrome.runtime.sendMessage(message).catch(() => null);
}

function broadcastProgress(tabId, progress) {
  lastProgress.set(tabId, progress);
  const payload = Object.assign({ type: MSG.JOB_PROGRESS, tabId }, progress);
  notifyPopup(payload);
  notifyTab(tabId, payload);
}

async function requestLectureContext(tabId, lectureId) {
  const response = await notifyTab(tabId, { type: MSG.GET_LECTURE_CONTEXT, lectureId });
  if (response?.lecture) {
    if (!lectureId) tabLectures.set(tabId, response.lecture);
    return response.lecture;
  }
  return lectureId ? null : tabLectures.get(tabId) || null;
}

/** Estado leve da aba (sem refazer as chamadas na API da Udemy). */
async function requestTabState(tabId) {
  const response = await notifyTab(tabId, { type: MSG.GET_TAB_STATE });
  if (response?.lecture) tabLectures.set(tabId, response.lecture);
  return response || null;
}

/**
 * Depois da aula atual, dubla as proximas do curso para que ao avancar o video
 * ja esteja pronto. Roda dentro do mesmo job, entao um "Dublar" manual
 * interrompe a fila.
 */
async function runPrefetchQueue({ tabId, settings, token, emit }) {
  const wanted = Number(settings.prefetchNext) || 0;
  if (wanted <= 0) return;

  const curriculum = await notifyTab(tabId, { type: MSG.GET_CURRICULUM });
  const items = curriculum?.items || [];
  const currentId = String(tabLectures.get(tabId)?.lectureId || '');
  const position = items.findIndex((item) => String(item.lectureId) === currentId);
  if (position === -1) {
    emit({ status: STATUS.DONE, message: 'Nao consegui ler a lista de aulas do curso' });
    return;
  }

  const upcoming = items.slice(position + 1);
  let completed = 0;

  for (const item of upcoming) {
    if (completed >= wanted) break;
    token.check();

    const existing = await findDubForLecture(item.lectureId, settings);
    if (existing && existing.total && existing.ready >= existing.total) continue;

    const lecture = await requestLectureContext(tabId, item.lectureId);
    if (!lecture) continue;
    lecture.title = lecture.title || item.title;

    const label = item.title || 'Aula ' + item.lectureId;
    const prefetchEmit = (progress) =>
      emit(
        Object.assign({}, progress, {
          lectureId: item.lectureId,
          prefetch: true,
          prefetchTitle: label,
          prefetchIndex: completed + 1,
          prefetchTotal: wanted
        })
      );

    try {
      await runJob({
        tabId,
        lecture,
        settings,
        startAt: 0,
        force: false,
        emit: prefetchEmit,
        token
      });
      completed++;
    } catch (error) {
      if (error instanceof CanceledError) throw error;
      console.warn('[udub] pre-dublagem falhou em', label, error);
      prefetchEmit({ status: STATUS.ERROR, message: 'Falhou em ' + label + ': ' + error.message });
    }
  }
}

async function startJob({ tabId, startAt, force, manual = true }) {
  const existing = jobs.get(tabId);
  if (existing) {
    // um "Dublar" manual tem prioridade sobre a fila de adiantamento
    if (!manual || !existing.prefetching) {
      return { ok: false, error: 'Ja existe uma dublagem em andamento nesta aba.' };
    }
    existing.token.cancel();
    await Promise.resolve(existing.promise).catch(() => {});
  }

  const lecture = await requestLectureContext(tabId);
  if (!lecture?.lectureId) {
    return { ok: false, error: 'Abra uma aula da Udemy (pagina do player) antes de dublar.' };
  }

  const settings = await getSettings();
  const token = new CancelToken();
  const job = { tabId, token, lecture, prefetching: false, startedAt: Date.now() };

  const emit = (progress) =>
    broadcastProgress(tabId, Object.assign({ lectureId: lecture.lectureId }, progress));

  job.promise = (async () => {
    try {
      const dub = await runJob({
        tabId,
        lecture,
        settings,
        startAt: Number(startAt) || Number(lecture.currentTime) || 0,
        force: Boolean(force),
        emit,
        token
      });
      const manifest = await getManifest(dub.key);
      await notifyTab(tabId, {
        type: MSG.DUB_READY,
        manifest,
        lectureId: lecture.lectureId,
        autoEnable: settings.autoEnable
      });

      job.prefetching = true;
      await runPrefetchQueue({ tabId, settings, token, emit });
      broadcastProgress(tabId, {
        lectureId: lecture.lectureId,
        status: STATUS.DONE,
        done: dub.ready,
        total: dub.total
      });
    } catch (error) {
      if (error instanceof CanceledError) {
        emit({ status: STATUS.CANCELED, message: 'Dublagem cancelada' });
      } else {
        console.error('[udub] job falhou', error);
        emit({ status: STATUS.ERROR, message: String(error?.message || error) });
      }
    } finally {
      jobs.delete(tabId);
    }
  })();

  jobs.set(tabId, job);
  return { ok: true };
}

async function listDubs() {
  const all = await db.getAll(db.STORE.DUBS);
  const usage = await db.estimateUsage();
  return {
    usage,
    dubs: all
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((dub) => ({
        key: dub.key,
        title: dub.title,
        lectureId: dub.lectureId,
        targetLang: dub.targetLang,
        ttsEngine: dub.ttsEngine,
        ready: dub.ready,
        total: dub.total,
        status: dub.status,
        updatedAt: dub.updatedAt
      }))
  };
}

const handlers = {
  async [MSG.CONTENT_READY](message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: false };
    tabLectures.set(tabId, message.lecture);
    const settings = await getSettings();
    const manifest = message.lecture?.lectureId
      ? await findDubForLecture(message.lecture.lectureId, settings)
      : null;
    return {
      ok: true,
      settings,
      manifest,
      job: jobs.has(tabId) ? lastProgress.get(tabId) || { status: STATUS.CONTEXT } : null
    };
  },

  async [MSG.GET_STATE](message) {
    const settings = await getSettings();
    const tabId = message.tabId;
    const tabState = tabId ? await requestTabState(tabId) : null;
    let lecture = tabState?.lecture || tabLectures.get(tabId) || null;
    if (!lecture && tabId) lecture = await requestLectureContext(tabId);

    const engines = resolveEngines(settings);
    const manifest = lecture?.lectureId ? await findDubForLecture(lecture.lectureId, settings) : null;

    return {
      ok: true,
      settings,
      engines,
      lecture,
      manifest,
      enabled: Boolean(tabState?.enabled),
      running: jobs.has(tabId),
      progress: lastProgress.get(tabId) || tabState?.progress || null,
      expectedKey: lecture?.lectureId
        ? dubKey({
            lectureId: lecture.lectureId,
            targetLang: settings.targetLang,
            ttsEngine: engines.ttsEngine,
            voice: engines.voice
          })
        : null
    };
  },

  [MSG.START_JOB](message, sender) {
    return startJob({
      tabId: message.tabId || sender.tab?.id,
      startAt: message.startAt,
      force: message.force
    });
  },

  [MSG.CANCEL_JOB](message, sender) {
    const job = jobs.get(message.tabId || sender.tab?.id);
    if (job) job.token.cancel();
    return Promise.resolve({ ok: Boolean(job) });
  },

  async [MSG.SET_SETTINGS](message) {
    const settings = await setSettings(message.patch);
    const tabs = await chrome.tabs.query({ url: ['https://*.udemy.com/course/*'] });
    for (const tab of tabs) notifyTab(tab.id, { type: MSG.APPLY_SETTINGS, settings });
    return { ok: true, settings, engines: resolveEngines(settings) };
  },

  [MSG.LIST_DUBS]() {
    return listDubs();
  },

  async [MSG.DELETE_DUB](message) {
    await db.deleteDub(message.key);
    return { ok: true };
  },

  async [MSG.CLEAR_CACHE]() {
    for (const store of Object.values(db.STORE)) await db.clearStore(store);
    return { ok: true };
  },

  async [MSG.SET_ENABLED](message, sender) {
    await notifyTab(message.tabId || sender.tab?.id, {
      type: MSG.APPLY_ENABLED,
      enabled: message.enabled
    });
    return { ok: true };
  },

  async [MSG.GET_MANIFEST](message) {
    const settings = await getSettings();
    const manifest = message.key
      ? await getManifest(message.key)
      : await findDubForLecture(message.lectureId, settings);
    return { ok: true, manifest, settings };
  },

  async [MSG.GET_CLIPS](message) {
    const from = Math.max(0, Number(message.from) || 0);
    const to = from + Math.max(1, Number(message.count) || 1) - 1;
    const rows = await db.getClipRange(message.key, from, to);
    return {
      ok: true,
      clips: rows.map((row) => ({ i: row.index, parts: row.parts, mime: row.mime }))
    };
  },

  async [MSG.VALIDATE_KEY](message) {
    try {
      const result = await deepgram.validateKey(message.apiKey);
      return { ok: true, projects: result.projects };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  },

  async [MSG.LOCAL_STATUS](message) {
    const settings = await getSettings();
    const cfg = localConfig(settings, message.engine);
    const response = await nativeSend({ action: 'status', engine: cfg.engine, port: cfg.port });
    // o /info do servidor diz em que dispositivo ele carregou o modelo
    const details = response?.running ? await localtts.info({ baseUrl: cfg.baseUrl }) : null;
    return Object.assign({}, response, { device: details?.device || null });
  },

  async [MSG.LOCAL_START](message) {
    const settings = await getSettings();
    const cfg = localConfig(settings, message.engine);
    return nativeSend({
      action: 'start',
      engine: cfg.engine,
      voice: cfg.voice,
      port: cfg.port,
      cuda: cfg.cuda
    });
  },

  async [MSG.LOCAL_STOP](message) {
    const settings = await getSettings();
    const cfg = localConfig(settings, message.engine);
    return nativeSend({ action: 'stop', engine: cfg.engine, port: cfg.port });
  },

  async [MSG.LOCAL_TEST](message) {
    const settings = await getSettings();
    const cfg = localConfig(settings, message.engine);
    try {
      const result = await localtts.ping({
        baseUrl: message.url || cfg.baseUrl,
        voice: message.voice || cfg.voice,
        label: cfg.label
      });
      return { ok: true, voices: result.voices, mode: result.mode, device: result.info?.device || null };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  },

  async [MSG.INWORLD_TEST](message) {
    try {
      const voices = await inworld.listVoices({
        apiKey: message.apiKey,
        language: message.language
      });
      return { ok: true, voices };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  },

  async [MSG.ELEVEN_TEST](message) {
    try {
      const [quota, voices] = await Promise.all([
        elevenlabs.getQuota({ apiKey: message.apiKey }),
        elevenlabs.listVoices({ apiKey: message.apiKey })
      ]);
      return { ok: true, quota, voices };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  },

  [MSG.PING](message, sender) {
    // mantem o service worker vivo durante o job e avisa se ele foi reciclado
    return Promise.resolve({ ok: true, running: jobs.has(message.tabId || sender.tab?.id) });
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message, sender)).then(sendResponse, (error) => {
    console.error('[udub] handler', message.type, error);
    sendResponse({ ok: false, error: String(error?.message || error) });
  });
  return true; // resposta assincrona
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const job = jobs.get(tabId);
  if (job) job.token.cancel();
  jobs.delete(tabId);
  tabLectures.delete(tabId);
  lastProgress.delete(tabId);
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await enforceCacheLimit(settings.cacheMaxDubs);
});
