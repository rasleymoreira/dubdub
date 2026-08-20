/*
 * Composition root do content script.
 *
 * Monta as pecas que rodam dentro da pagina da Udemy e faz a ponte com o
 * service worker. A logica de verdade esta nos casos de uso; aqui so ha
 * ligacao, ciclo de vida da SPA e roteamento de mensagem.
 */

import { JobStatus, isTerminal } from '../../domain/entities/JobStatus.ts';
import type { Lecture } from '../../domain/entities/Lecture.ts';
import type { DubManifest } from '../../application/dto/DubManifest.ts';
import type { JobProgress } from '../../application/dto/JobProgress.ts';
import type { Settings } from '../../application/dto/Settings.ts';
import { DEFAULT_SETTINGS } from '../../infrastructure/catalog/defaults.ts';
import { describeEngine } from '../../infrastructure/catalog/engines.catalog.ts';
import { ConsoleLogger } from '../../infrastructure/logging/ConsoleLogger.ts';
import { MSG } from '../../infrastructure/messaging/contracts.ts';
import { MessageBus, unwrap } from '../../infrastructure/messaging/MessageBus.ts';
import { DubPlaybackEngine } from './playback/DubPlaybackEngine.ts';
import { OverlayView } from './overlay/OverlayView.ts';
import { UdemyPageAdapter, findVideo, parseLectureUrl } from './udemy/UdemyPageAdapter.ts';

/** A Udemy e uma SPA: trocar de aula nao recarrega a pagina. */
const LOCATION_POLL_MS = 800;
/**
 * Mantem o service worker acordado durante um job. O Chrome recicla o worker
 * ocioso em ~30 s, o que mataria a dublagem no meio.
 */
const KEEPALIVE_MS = 15000;
/** O contexto da aula pode nao estar pronto no primeiro carregamento da SPA. */
const CONTEXT_RETRIES = 5;
const CONTEXT_RETRY_DELAY_MS = 1500;

const logger = new ConsoleLogger('content');
const bus = new MessageBus(logger);
const udemy = new UdemyPageAdapter(logger);

let settings: Settings = DEFAULT_SETTINGS;
let lecture: Lecture | null = null;
let currentLectureId: string | null = null;
let progress: JobProgress = { status: JobStatus.IDLE };
let running = false;
let prefetchInfo: JobProgress | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let pendingManifestKey: string | null = null;
let lastHref = '';

const engine = new DubPlaybackEngine({
  fetchClips: async (key, from, count) => {
    const response = unwrap(await bus.send(MSG.GET_CLIPS, { key, from, count }));
    return response ? [...response.clips] : [];
  },
  onStatus: () => render(),
  logger
});

const overlay = new OverlayView(
  {
    onStart: () => void startJob(engine.hasDub()),
    onCancel: () => void bus.send(MSG.CANCEL_JOB, { tabId: null }),
    onToggle: () => {
      engine.toggle();
      render();
    },
    onOriginalVolume: (value) => {
      settings = { ...settings, originalVolume: value };
      engine.applySettings(settings);
      void bus.send(MSG.SET_SETTINGS, { patch: { originalVolume: value } });
    }
  },
  DEFAULT_SETTINGS.showOverlay
);

// ---------------------------------------------------------------- renderizacao

function render(): void {
  const manifest = engine.manifest;
  overlay.render({
    running,
    status: progress.status ?? JobStatus.IDLE,
    message: progress.message ?? '',
    done: progress.done ?? 0,
    total: progress.total ?? manifest?.total ?? 0,
    notes: progress.notes ?? manifest?.notes ?? [],
    hasDub: engine.hasDub(),
    enabled: engine.enabled,
    engineLabel: manifest ? describeEngine(manifest.ttsEngine).label : null,
    lang: manifest?.targetLang ?? null,
    originalVolume: settings.originalVolume,
    prefetch: prefetchInfo
      ? {
          title: prefetchInfo.prefetchTitle ?? '',
          index: prefetchInfo.prefetchIndex ?? 1,
          count: prefetchInfo.prefetchTotal ?? 1
        }
      : null
  });
}

function applyOverlayVisibility(): void {
  if (settings.showOverlay && parseLectureUrl(location.href)) overlay.show();
  else overlay.hide();
}

// -------------------------------------------------------------------- keepalive

function setRunning(value: boolean): void {
  running = value;

  if (value && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => void keepAlive(), KEEPALIVE_MS);
  }
  if (!value && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

/**
 * Se o worker foi reciclado no meio do job, o job morreu junto. Destravamos o
 * painel e carregamos o que ficou pronto: Redublar retoma de onde parou.
 */
async function keepAlive(): Promise<void> {
  const response = unwrap(await bus.send(MSG.PING, { tabId: null }));
  if (!response || response.running || !running) return;

  setRunning(false);
  progress = { status: JobStatus.IDLE, message: 'Geracao interrompida pelo navegador' };

  const manifest = unwrap(
    await bus.send(MSG.GET_MANIFEST, { lectureId: currentLectureId ?? undefined })
  );
  if (manifest?.manifest) applyManifest(manifest.manifest, settings.autoEnable);
  render();
}

// -------------------------------------------------------------------- jobs

async function startJob(force: boolean): Promise<void> {
  progress = { status: JobStatus.CONTEXT, message: 'Preparando' };
  setRunning(true);
  render();

  const response = await bus.send(MSG.START_JOB, {
    tabId: null,
    startAt: findVideo()?.currentTime ?? 0,
    force
  });

  if (!response?.ok) {
    setRunning(false);
    progress = {
      status: JobStatus.ERROR,
      message: response?.error ?? 'Nao consegui iniciar a dublagem'
    };
    render();
  }
}

function applyManifest(manifest: DubManifest | null, autoEnable: boolean): void {
  engine.setManifest(manifest);
  if (!manifest) {
    render();
    return;
  }

  const video = findVideo();
  if (video) engine.attach(video);
  if (autoEnable && !engine.enabled) engine.enable();
  render();
}

/** O contexto pode nao estar pronto logo apos a navegacao da SPA. */
async function resolveContext(): Promise<Lecture | null> {
  for (let attempt = 0; attempt < CONTEXT_RETRIES; attempt++) {
    const context = await udemy.getLectureContext();
    if (!context) return null;

    const usable =
      context.captions.length > 0 ||
      context.mediaSources.length > 0 ||
      context.localCues.length > 0;
    if (usable || attempt === CONTEXT_RETRIES - 1) return context;

    await new Promise((resolve) => setTimeout(resolve, CONTEXT_RETRY_DELAY_MS));
  }
  return null;
}

async function bootLecture(): Promise<void> {
  lecture = await resolveContext();
  if (!lecture) return;

  const response = unwrap(await bus.send(MSG.CONTENT_READY, { lecture }));
  if (response?.settings) {
    settings = response.settings;
    engine.applySettings(settings);
    applyOverlayVisibility();
  }

  if (response?.progress) {
    progress = response.progress;
    setRunning(true);
  } else {
    setRunning(false);
  }

  applyManifest(response?.manifest ?? null, settings.autoEnable);

  if (!response?.manifest && settings.autoDub && !running) void startJob(false);
  render();
}

function onLocationChange(): void {
  const ids = parseLectureUrl(location.href);
  applyOverlayVisibility();
  if (!ids || ids.lectureId === currentLectureId) return;

  // a fila de adiantamento segue rodando no worker; o estado real vem do
  // CONTENT_READY logo abaixo
  currentLectureId = ids.lectureId;
  progress = { status: JobStatus.IDLE };
  engine.disable();
  engine.setManifest(null);
  render();
  void bootLecture();
}

/**
 * Vigia a SPA por polling. Nao ha evento confiavel: a Udemy usa history.pushState
 * e troca o elemento <video> sem avisar.
 */
function watch(): void {
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onLocationChange();
    }

    const video = findVideo();
    if (video && video !== engine.video) {
      engine.attach(video);
      if (engine.hasDub() && settings.autoEnable && !engine.enabled) engine.enable();
    }
  }, LOCATION_POLL_MS);

  window.addEventListener('popstate', () => setTimeout(onLocationChange, 300));
}

// ------------------------------------------------------- mensagens do worker

bus
  .on(MSG.GET_LECTURE_CONTEXT, async ({ lectureId }) => {
    // com lectureId, le outra aula do curso (fila de adiantamento)
    if (lectureId && lectureId !== currentLectureId) {
      return { lecture: await udemy.getLectureContext(lectureId) };
    }
    const context = await resolveContext();
    if (context) lecture = context;
    return { lecture: context };
  })
  .on(MSG.GET_CURRICULUM, async () => ({ items: await udemy.getCurriculum() }))
  .on(MSG.GET_TAB_STATE, () => ({
    lecture,
    enabled: engine.enabled,
    hasDub: engine.hasDub(),
    running,
    progress
  }))
  .on(MSG.FETCH_TEXT, async ({ url }) => ({ text: await udemy.fetchText(url) }))
  .on(MSG.JOB_PROGRESS, ({ progress: incoming }) => {
    onProgress(incoming);
    return {};
  })
  .on(MSG.DUB_READY, ({ manifest, lectureId, autoEnable }) => {
    if (!lectureId || lectureId === currentLectureId) applyManifest(manifest, autoEnable);
    return {};
  })
  .on(MSG.APPLY_SETTINGS, ({ settings: incoming }) => {
    settings = incoming;
    engine.applySettings(settings);
    applyOverlayVisibility();
    render();
    return {};
  })
  .on(MSG.APPLY_ENABLED, ({ enabled }) => {
    if (enabled) engine.enable();
    else engine.disable();
    render();
    return {};
  });

function onProgress(incoming: JobProgress): void {
  const mine = String(incoming.lectureId ?? '') === String(currentLectureId);
  // um job de adiantamento que termina nao encerra a fila inteira
  const finished = !incoming.prefetch && isTerminal(incoming.status);

  setRunning(!finished);
  prefetchInfo = mine || finished ? null : incoming.prefetch ? incoming : prefetchInfo;

  if (mine) {
    progress = incoming;
    // durante a sintese ja da para tocar o que ficou pronto
    if (incoming.status === JobStatus.SYNTHESIZING && incoming.key) {
      void adoptManifest(incoming.key);
    }
  }

  render();
}

/** Puxa o manifesto novo uma vez so, mesmo com progresso chegando a cada trecho. */
async function adoptManifest(key: string): Promise<void> {
  if (engine.manifest?.key === key) {
    engine.refreshAvailability();
    return;
  }
  if (pendingManifestKey === key) return;

  pendingManifestKey = key;
  const response = unwrap(await bus.send(MSG.GET_MANIFEST, { key }));
  pendingManifestKey = null;
  if (response?.manifest) applyManifest(response.manifest, settings.autoEnable);
}

// ------------------------------------------------------------------- boot

function boot(): void {
  bus.listen();
  applyOverlayVisibility();

  lastHref = location.href;
  const ids = parseLectureUrl(location.href);
  if (ids) {
    currentLectureId = ids.lectureId;
    void bootLecture();
  }

  const video = findVideo();
  if (video) engine.attach(video);

  watch();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
