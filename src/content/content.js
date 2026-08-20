/*
 * Cola tudo dentro da pagina da Udemy: detecta a aula, mantem o HUD, conversa
 * com o service worker e alimenta o motor de dublagem.
 */

(function () {
  'use strict';

  const { MSG, STATUS, DEFAULTS } = globalThis.UDUB;

  const POLL_MS = 800;
  const PING_MS = 15000;
  const CONTEXT_RETRIES = 5;

  let settings = Object.assign({}, DEFAULTS);
  let engine = null;
  let overlay = null;
  let lecture = null;
  let currentLectureId = null;
  let progress = { status: STATUS.IDLE };
  let running = false;
  let pingTimer = null;
  let lastHref = '';
  let pendingManifestKey = null;
  let prefetchInfo = null;

  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      return Promise.resolve(null); // contexto da extensao recarregado
    }
  }

  function render() {
    if (!overlay) return;
    overlay.render({
      running,
      status: progress.status || STATUS.IDLE,
      message: progress.message || '',
      done: progress.done || 0,
      total: progress.total || (engine?.hasDub() ? engine.segments.length : 0),
      notes: progress.notes || engine?.manifest?.notes || [],
      hasDub: Boolean(engine?.hasDub()),
      enabled: Boolean(engine?.enabled),
      engine: engine?.manifest?.ttsEngine || null,
      lang: engine?.manifest?.targetLang || null,
      originalVolume: settings.originalVolume,
      prefetch: prefetchInfo
        ? {
            title: prefetchInfo.prefetchTitle || '',
            done: prefetchInfo.done || 0,
            total: prefetchInfo.total || 0,
            index: prefetchInfo.prefetchIndex || 1,
            count: prefetchInfo.prefetchTotal || 1
          }
        : null
    });
  }

  function setRunning(value) {
    running = value;
    if (value && !pingTimer) pingTimer = setInterval(keepAlive, PING_MS);
    if (!value && pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  /**
   * Mantem o service worker acordado enquanto o job roda. Se ele foi reciclado
   * pelo Chrome, o job morreu: destravamos o HUD e carregamos o que ficou
   * pronto (clicar em "Redublar" retoma de onde parou).
   */
  async function keepAlive() {
    const response = await send({ type: MSG.PING });
    if (!response || response.running !== false || !running) return;
    setRunning(false);
    progress = { status: STATUS.IDLE, message: 'Geracao interrompida pelo navegador' };
    const manifestResponse = await send({ type: MSG.GET_MANIFEST, lectureId: currentLectureId });
    if (manifestResponse?.manifest) await applyManifest(manifestResponse.manifest, settings.autoEnable);
    render();
  }

  async function startJob(force) {
    const video = UDUB_Udemy.findVideo();
    progress = { status: STATUS.CONTEXT, message: 'Preparando' };
    setRunning(true);
    render();
    const response = await send({
      type: MSG.START_JOB,
      startAt: video?.currentTime || 0,
      force: Boolean(force)
    });
    if (!response?.ok) {
      setRunning(false);
      progress = { status: STATUS.ERROR, message: response?.error || 'Nao consegui iniciar a dublagem' };
      render();
    }
  }

  function cancelJob() {
    send({ type: MSG.CANCEL_JOB });
  }

  async function applyManifest(manifest, autoEnable) {
    if (!manifest) {
      engine.setManifest(null);
      render();
      return;
    }
    engine.setManifest(manifest);
    const video = UDUB_Udemy.findVideo();
    if (video) engine.attach(video);
    if (autoEnable && !engine.enabled) await engine.enable();
    render();
  }

  /** O contexto pode nao estar pronto no primeiro carregamento da SPA. */
  async function resolveContext() {
    for (let attempt = 0; attempt < CONTEXT_RETRIES; attempt++) {
      const context = await UDUB_Udemy.getLectureContext();
      if (!context) return null;
      const usable = context.captions.length || context.mediaSources.length || context.localCues.length;
      if (usable || attempt === CONTEXT_RETRIES - 1) return context;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return null;
  }

  async function bootLecture() {
    lecture = await resolveContext();
    if (!lecture) return;

    const response = await send({ type: MSG.CONTENT_READY, lecture });
    if (response?.settings) {
      settings = response.settings;
      engine.applySettings(settings);
      applyOverlayVisibility();
    }
    if (response?.job) {
      progress = response.job;
      setRunning(true);
    } else {
      setRunning(false);
    }
    await applyManifest(response?.manifest || null, settings.autoEnable);

    if (!response?.manifest && settings.autoDub && !running) startJob(false);
    render();
  }

  /** O painel flutuante so aparece se estiver ligado nos ajustes. */
  function applyOverlayVisibility() {
    if (!overlay) return;
    if (settings.showOverlay && UDUB_Udemy.parseUrl(location.href)) overlay.show();
    else overlay.hide();
  }

  function onLocationChange() {
    const ids = UDUB_Udemy.parseUrl(location.href);
    applyOverlayVisibility();
    if (!ids) return;
    if (ids.lectureId === currentLectureId) return;

    // a fila de adiantamento continua rodando no service worker; o estado real
    // vem do CONTENT_READY logo abaixo
    currentLectureId = ids.lectureId;
    progress = { status: STATUS.IDLE };
    engine.disable();
    engine.setManifest(null);
    render();
    bootLecture();
  }

  function watch() {
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        onLocationChange();
      }
      const video = UDUB_Udemy.findVideo();
      if (video && video !== engine.video) {
        engine.attach(video);
        if (engine.hasDub() && settings.autoEnable && !engine.enabled) engine.enable();
      }
    }, POLL_MS);
    window.addEventListener('popstate', () => setTimeout(onLocationChange, 300));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message?.type) {
      case MSG.GET_LECTURE_CONTEXT:
        // com lectureId, le outra aula do curso (fila de adiantamento)
        if (message.lectureId && String(message.lectureId) !== String(currentLectureId)) {
          UDUB_Udemy.getLectureContext(message.lectureId)
            .then((context) => sendResponse({ lecture: context }))
            .catch((error) => sendResponse({ lecture: null, error: String(error.message || error) }));
        } else {
          resolveContext().then((context) => {
            if (context) lecture = context;
            sendResponse({ lecture: context });
          });
        }
        return true;

      case MSG.GET_CURRICULUM:
        UDUB_Udemy.getCurriculum()
          .then(sendResponse)
          .catch((error) => sendResponse({ items: [], error: String(error.message || error) }));
        return true;

      case MSG.GET_TAB_STATE:
        sendResponse({
          lecture,
          enabled: Boolean(engine?.enabled),
          hasDub: Boolean(engine?.hasDub()),
          running,
          progress
        });
        return false;

      case MSG.FETCH_TEXT:
        fetch(message.url, { credentials: 'omit' })
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.text();
          })
          .then((text) => sendResponse({ ok: true, text }))
          .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
        return true;

      case MSG.JOB_PROGRESS: {
        const mine = String(message.lectureId || '') === String(currentLectureId);
        // um job de adiantamento que termina nao encerra a fila
        const finished =
          !message.prefetch &&
          (message.status === STATUS.DONE ||
            message.status === STATUS.ERROR ||
            message.status === STATUS.CANCELED);
        setRunning(!finished);
        prefetchInfo = mine || finished ? null : message.prefetch ? message : prefetchInfo;

        if (mine) {
          progress = message;
          // durante a sintese ja da pra tocar o que ficou pronto
          if (message.status === STATUS.SYNTHESIZING && message.key) {
            if (engine.manifest?.key !== message.key) {
              if (pendingManifestKey !== message.key) {
                pendingManifestKey = message.key;
                send({ type: MSG.GET_MANIFEST, key: message.key }).then((response) => {
                  pendingManifestKey = null;
                  if (response?.manifest) applyManifest(response.manifest, settings.autoEnable);
                });
              }
            } else {
              engine.refreshAvailability();
            }
          }
        }
        render();
        return false;
      }

      case MSG.DUB_READY:
        if (!message.lectureId || String(message.lectureId) === String(currentLectureId)) {
          applyManifest(message.manifest, message.autoEnable ?? settings.autoEnable);
        }
        return false;

      case MSG.APPLY_SETTINGS:
        settings = message.settings;
        engine.applySettings(settings);
        applyOverlayVisibility();
        render();
        return false;

      case MSG.APPLY_ENABLED:
        if (message.enabled) engine.enable().then(render);
        else {
          engine.disable();
          render();
        }
        return false;

      default:
        return false;
    }
  });

  function boot() {
    engine = new UDUB_Engine.DubEngine({
      requestClips: async (key, from, count) => {
        const response = await send({ type: MSG.GET_CLIPS, key, from, count });
        return response?.clips || [];
      },
      onStatus: render
    });

    overlay = UDUB_Overlay.create({
      visible: settings.showOverlay,
      onStart: () => startJob(engine.hasDub()),
      onCancel: cancelJob,
      onToggle: async () => {
        await engine.toggle();
        render();
      },
      onOriginalVolume: (value) => {
        settings.originalVolume = value;
        engine.applySettings(settings);
        send({ type: MSG.SET_SETTINGS, patch: { originalVolume: value } });
      }
    });

    applyOverlayVisibility();

    lastHref = location.href;
    const ids = UDUB_Udemy.parseUrl(location.href);
    if (ids) {
      currentLectureId = ids.lectureId;
      bootLecture();
    }

    const video = UDUB_Udemy.findVideo();
    if (video) engine.attach(video);
    watch();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
