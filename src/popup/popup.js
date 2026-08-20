/* Popup: preferencias, disparo do job e estado da dublagem da aba atual. */

(function () {
  'use strict';

  const {
    MSG,
    STATUS,
    STATUS_LABEL,
    DEFAULTS,
    TTS_ENGINES,
    KOKORO_PT_VOICES,
    INWORLD_PT_VOICES,
    INWORLD_MODELS,
    TARGET_LANGS,
    SOURCE_LANGS,
    baseLang,
    deepgramVoicesFor
  } = globalThis.UDUB;

  const VOICE_CACHE_KEY = 'elevenVoicesCache';
  const INWORLD_CACHE_KEY = 'inworldVoicesCache';
  const $ = (id) => document.getElementById(id);

  let tabId = null;
  let settings = Object.assign({}, DEFAULTS);
  let engines = null;
  let lecture = null;
  let manifest = null;
  let running = false;
  let progress = null;
  let playerEnabled = false;
  let elevenVoices = [];
  let inworldVoices = [];

  function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => null);
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  async function patchSettings(patch) {
    Object.assign(settings, patch);
    const response = await send({ type: MSG.SET_SETTINGS, patch });
    if (response?.settings) settings = response.settings;
    if (response?.engines) engines = response.engines;
    renderEngines();
    renderStatus();
  }

  const patchSettingsDebounced = debounce(patchSettings, 300);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char];
    });
  }

  // ------------------------------------------------------------------ render

  function fillSelect(select, items, value) {
    select.innerHTML = items
      .map(
        (item) =>
          '<option value="' +
          escapeHtml(item.code) +
          '"' +
          (String(item.code) === String(value) ? ' selected' : '') +
          '>' +
          escapeHtml(item.label) +
          '</option>'
      )
      .join('');
  }

  function renderDeepgramVoices() {
    const voices = deepgramVoicesFor(settings.targetLang);
    const select = $('deepgramVoice');
    if (!voices.length) {
      select.innerHTML = '<option value="">sem voz para este idioma</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    fillSelect(
      select,
      voices.map((voice) => ({
        code: voice,
        label: voice.replace('aura-2-', '').replace(/-(\w+)$/, ' ($1)')
      })),
      settings.deepgramVoice
    );
  }

  /** Vozes do Inworld: catalogo local + o que a API devolver no teste. */
  function renderInworldVoices() {
    const fromApi = inworldVoices.map((voice) => ({
      code: voice.id,
      label: voice.name + (voice.description ? ' — ' + voice.description.slice(0, 40) : '')
    }));
    const items = fromApi.length ? fromApi : INWORLD_PT_VOICES;
    if (!items.some((item) => item.code === settings.inworldVoiceId)) {
      items.unshift({ code: settings.inworldVoiceId, label: settings.inworldVoiceId });
    }
    fillSelect($('inworldVoiceId'), items, settings.inworldVoiceId);
    fillSelect($('inworldModel'), INWORLD_MODELS, settings.inworldModel);
  }

  function renderElevenVoices() {
    const select = $('elevenVoiceId');
    const items = elevenVoices.length
      ? elevenVoices.map((voice) => ({ code: voice.id, label: voice.name }))
      : [{ code: settings.elevenVoiceId, label: settings.elevenVoiceId + ' (clique em Testar para listar)' }];
    fillSelect(select, items, settings.elevenVoiceId);
  }

  /** Motores que rodam em servidor local, com os ids dos controles no HTML. */
  const LOCAL_PANELS = {
    kokoro: {
      label: 'Kokoro',
      url: 'kokoroUrl',
      voice: 'kokoroVoice',
      voiceKind: 'select',
      cuda: 'kokoroCuda',
      dot: 'kokoroDot',
      state: 'kokoroState',
      start: 'kokoroStartBtn',
      stop: 'kokoroStopBtn',
      test: 'testKokoroBtn',
      hint: 'kokoroHint'
    },
    piper: {
      label: 'Piper',
      url: 'piperUrl',
      voice: 'piperVoice',
      voiceKind: 'text',
      datalist: 'piperVoiceList',
      cuda: 'piperCuda',
      dot: 'piperDot',
      state: 'piperState',
      start: 'piperStartBtn',
      stop: 'piperStopBtn',
      test: 'testPiperBtn',
      hint: 'piperHint'
    },
    f5: {
      label: 'F5-TTS',
      url: 'f5Url',
      voice: 'f5Voice',
      voiceKind: 'text',
      datalist: 'f5VoiceList',
      cuda: 'f5Cuda',
      dot: 'f5Dot',
      state: 'f5State',
      start: 'f5StartBtn',
      stop: 'f5StopBtn',
      test: 'testF5Btn',
      hint: 'f5Hint'
    }
  };

  function setLocalState(engine, text, state) {
    const panel = LOCAL_PANELS[engine];
    $(panel.state).textContent = text;
    $(panel.dot).dataset.state = state;
  }

  /**
   * Estado do servidor local via native messaging host. Sem o host instalado a
   * extensao segue funcionando: so nao consegue ligar/desligar sozinha.
   */
  async function refreshLocalStatus(engine) {
    const panel = LOCAL_PANELS[engine];
    if (!panel) return;

    const response = await send({ type: MSG.LOCAL_STATUS, engine });
    const running = Boolean(response?.ok && response.running);

    if (response?.missing) {
      setLocalState(engine, 'controle nao instalado — rode tools\\install-native-host.ps1', 'error');
    } else if (!response?.ok) {
      setLocalState(engine, response?.error || 'sem resposta do controle', 'error');
    } else {
      setLocalState(
        engine,
        running
          ? 'no ar na porta ' + response.port + (response.device ? ' · ' + response.device : '')
          : 'servidor desligado',
        running ? 'ready' : 'idle'
      );
    }

    $(panel.start).disabled = running;
    $(panel.stop).disabled = !running;
  }

  /** Consulta so o motor local que esta selecionado. */
  function refreshSelectedLocal() {
    const current = engines?.ttsEngine || settings.ttsEngine;
    if (LOCAL_PANELS[current]) refreshLocalStatus(current);
  }

  function renderEngines() {
    for (const button of document.querySelectorAll('#providerToggle button')) {
      button.setAttribute('aria-pressed', String(button.dataset.provider === settings.provider));
    }

    const current = engines?.ttsEngine || settings.ttsEngine;
    fillSelect(
      $('ttsEngine'),
      TTS_ENGINES.map((engine) => ({ code: engine.id, label: engine.label })),
      settings.ttsEngine === 'auto' ? current : settings.ttsEngine
    );

    for (const panel of document.querySelectorAll('.engine-panel')) {
      panel.hidden = panel.dataset.engine !== current;
    }

    const stt = engines?.sttProvider;
    const chosen = TTS_ENGINES.find((engine) => engine.id === current);
    $('providerHint').textContent = engines
      ? 'Texto: ' +
        (stt === 'deepgram' ? 'Deepgram ' + settings.deepgramSttModel : 'legendas da Udemy') +
        ' · Traducao: Google · ' +
        (chosen?.hint || '')
      : '';

    const warn = $('providerWarn');
    const notes = engines?.notes || [];
    warn.hidden = notes.length === 0;
    warn.textContent = notes.join(' ');

    $('engineBadge').textContent = chosen ? chosen.label + ' · ' + settings.targetLang : '--';
  }

  function renderStatus() {
    const status = progress?.status || (manifest ? STATUS.DONE : STATUS.IDLE);
    const total = progress?.total || manifest?.total || 0;
    const done = progress?.done ?? manifest?.ready ?? 0;
    const percent = total ? Math.round((done / total) * 100) : 0;
    const isPrefetch = Boolean(progress?.prefetch);

    $('statusText').textContent = running
      ? isPrefetch
        ? 'Adiantando proximas aulas'
        : STATUS_LABEL[status] || 'Trabalhando'
      : manifest
        ? 'Dublagem pronta'
        : status === STATUS.ERROR
          ? 'Erro'
          : 'Sem dublagem nesta aula';
    $('statusCount').textContent = total ? done + '/' + total + ' (' + percent + '%)' : '';
    $('progressBar').style.width = (running || manifest ? percent : 0) + '%';
    $('statusDot').dataset.state = running
      ? 'working'
      : status === STATUS.ERROR
        ? 'error'
        : manifest
          ? 'ready'
          : 'idle';

    const prefetchHint = $('prefetchHint');
    prefetchHint.hidden = !isPrefetch;
    if (isPrefetch) {
      prefetchHint.textContent =
        'Adiantando ' +
        (progress.prefetchIndex || 1) +
        '/' +
        (progress.prefetchTotal || 1) +
        ': ' +
        (progress.prefetchTitle || 'proxima aula');
    }

    const hints = [];
    if (progress?.message && running && !isPrefetch) hints.push(progress.message);
    if (progress?.status === STATUS.ERROR && progress.message) hints.push(progress.message);
    if (progress?.failures) hints.push(progress.failures + ' trecho(s) falharam');
    if (manifest && !running) {
      hints.push(
        'Voz: ' +
          (manifest.voice || manifest.ttsEngine) +
          ' · origem do texto: ' +
          (manifest.sttProvider === 'deepgram' ? 'Deepgram' : 'legendas')
      );
    }
    for (const note of manifest?.notes || []) hints.push(note);
    $('jobHint').textContent = hints.join(' · ');

    const startBtn = $('startBtn');
    startBtn.textContent = running ? 'Cancelar' : manifest ? 'Refazer dublagem' : 'Dublar esta aula';
    startBtn.disabled = !lecture;
    startBtn.classList.toggle('primary', !running);

    const toggleBtn = $('toggleBtn');
    toggleBtn.disabled = !manifest;
    toggleBtn.textContent = playerEnabled ? 'Desativar no player' : 'Ativar no player';
    toggleBtn.classList.toggle('active', playerEnabled);

    $('lecture').textContent = lecture
      ? lecture.title || 'Aula ' + lecture.lectureId
      : 'Abra uma aula da Udemy';
    $('lecture').title = lecture?.title || '';
  }

  function renderSettings() {
    fillSelect($('sourceLang'), SOURCE_LANGS, settings.sourceLang);
    fillSelect($('targetLang'), TARGET_LANGS, settings.targetLang);
    renderDeepgramVoices();
    renderElevenVoices();
    renderInworldVoices();
    $('inworldApiKey').value = settings.inworldApiKey || '';
    $('piperUrl').value = settings.piperUrl || '';
    $('piperVoice').value = settings.piperVoice || '';
    $('piperCuda').checked = settings.piperCuda;
    $('kokoroUrl').value = settings.kokoroUrl || '';
    $('kokoroCuda').checked = settings.kokoroCuda;
    fillSelect($('kokoroVoice'), KOKORO_PT_VOICES, settings.kokoroVoice);
    $('f5Url').value = settings.f5Url || '';
    $('f5Voice').value = settings.f5Voice || '';
    $('f5Cuda').checked = settings.f5Cuda;
    $('elevenApiKey').value = settings.elevenApiKey || '';
    $('elevenModel').value = settings.elevenModel;
    $('deepgramSttModel').value = settings.deepgramSttModel;
    $('deepgramApiKey').value = settings.deepgramApiKey || '';
    $('prefetchNext').value = String(settings.prefetchNext);
    $('cacheMaxDubs').value = String(settings.cacheMaxDubs);
    $('originalVolume').value = String(Math.round(settings.originalVolume * 100));
    $('originalVolumeValue').textContent = Math.round(settings.originalVolume * 100) + '%';
    $('dubVolume').value = String(Math.round(settings.dubVolume * 100));
    $('dubVolumeValue').textContent = Math.round(settings.dubVolume * 100) + '%';
    $('maxSpeedup').value = String(Math.round(settings.maxSpeedup * 100));
    $('maxSpeedupValue').textContent = settings.maxSpeedup.toFixed(2) + 'x';
    $('autoEnable').checked = settings.autoEnable;
    $('autoDub').checked = settings.autoDub;
    $('startFromPlayhead').checked = settings.startFromPlayhead;
    $('showOverlay').checked = settings.showOverlay;
  }

  async function renderCache() {
    const response = await send({ type: MSG.LIST_DUBS });
    const list = $('dubList');
    const dubs = response?.dubs || [];
    $('cacheCount').textContent = dubs.length ? dubs.length + ' aula(s)' : '';

    if (!dubs.length) {
      list.innerHTML = '<li class="empty">Nada salvo ainda</li>';
    } else {
      list.innerHTML = dubs
        .map(
          (dub) =>
            '<li><span class="name" title="' +
            escapeHtml(dub.title || dub.lectureId) +
            '">' +
            escapeHtml(dub.title || 'Aula ' + dub.lectureId) +
            '</span><span class="meta">' +
            dub.ready +
            '/' +
            dub.total +
            ' · ' +
            escapeHtml(String(dub.ttsEngine || '').slice(0, 6)) +
            '</span><button class="del" data-key="' +
            escapeHtml(dub.key) +
            '" title="Apagar">&times;</button></li>'
        )
        .join('');
    }

    const usage = response?.usage;
    $('usageHint').textContent = usage ? (usage.usage / 1048576).toFixed(1) + ' MB em cache' : '';

    for (const button of list.querySelectorAll('.del')) {
      button.addEventListener('click', async () => {
        await send({ type: MSG.DELETE_DUB, key: button.dataset.key });
        if (manifest?.key === button.dataset.key) manifest = null;
        renderStatus();
        renderCache();
      });
    }
  }

  // ------------------------------------------------------------------ eventos

  function bind() {
    for (const button of document.querySelectorAll('#providerToggle button')) {
      button.addEventListener('click', () => patchSettings({ provider: button.dataset.provider }));
    }

    $('ttsEngine').addEventListener('change', async (event) => {
      await patchSettings({ ttsEngine: event.target.value });
      refreshSelectedLocal();
    });

    $('startBtn').addEventListener('click', async () => {
      if (running) {
        await send({ type: MSG.CANCEL_JOB, tabId });
        return;
      }
      running = true;
      progress = { status: STATUS.CONTEXT, message: 'Preparando' };
      renderStatus();
      const response = await send({ type: MSG.START_JOB, tabId, force: Boolean(manifest) });
      if (!response?.ok) {
        running = false;
        progress = { status: STATUS.ERROR, message: response?.error || 'Falha ao iniciar' };
        renderStatus();
      }
    });

    $('toggleBtn').addEventListener('click', async () => {
      playerEnabled = !playerEnabled;
      renderStatus();
      await send({ type: MSG.SET_ENABLED, tabId, enabled: playerEnabled });
    });

    $('sourceLang').addEventListener('change', (event) =>
      patchSettings({ sourceLang: event.target.value })
    );
    $('targetLang').addEventListener('change', async (event) => {
      await patchSettings({ targetLang: event.target.value });
      renderDeepgramVoices();
    });

    // Piper e Kokoro compartilham os mesmos controles
    for (const [engine, panel] of Object.entries(LOCAL_PANELS)) {
      $(panel.url).addEventListener('input', (event) =>
        patchSettingsDebounced({ [panel.url]: event.target.value.trim() })
      );

      const voiceEvent = panel.voiceKind === 'select' ? 'change' : 'input';
      $(panel.voice).addEventListener(voiceEvent, (event) =>
        patchSettingsDebounced({ [panel.voice]: event.target.value.trim() })
      );

      $(panel.start).addEventListener('click', async () => {
        $(panel.start).disabled = true;
        $(panel.stop).disabled = true;
        setLocalState(engine, 'ligando (carregar o modelo leva alguns segundos)...', 'working');
        const response = await send({ type: MSG.LOCAL_START, engine });
        if (!response?.ok) {
          setLocalState(
            engine,
            response?.missing
              ? 'controle nao instalado — rode tools\\install-native-host.ps1'
              : response?.error || 'falhou',
            'error'
          );
        }
        refreshLocalStatus(engine);
      });

      $(panel.stop).addEventListener('click', async () => {
        $(panel.start).disabled = true;
        $(panel.stop).disabled = true;
        setLocalState(engine, 'desligando...', 'working');
        const response = await send({ type: MSG.LOCAL_STOP, engine });
        if (!response?.ok) setLocalState(engine, response?.error || 'falhou', 'error');
        refreshLocalStatus(engine);
      });

      $(panel.test).addEventListener('click', async () => {
        const hint = $(panel.hint);
        hint.textContent = 'Testando ' + $(panel.url).value + '...';
        const response = await send({
          type: MSG.LOCAL_TEST,
          engine,
          url: $(panel.url).value.trim(),
          voice: $(panel.voice).value.trim()
        });
        if (response?.ok) {
          hint.textContent =
            panel.label + ' respondeu (formato ' + (response.mode || 'ok') + ')' +
            (response.device ? ' · ' + response.device : '') +
            (response.voices?.length ? ' · ' + response.voices.length + ' voz(es)' : '');
          if (panel.datalist) {
            $(panel.datalist).innerHTML = (response.voices || [])
              .map((voice) => '<option value="' + escapeHtml(voice) + '"></option>')
              .join('');
          }
        } else {
          hint.textContent = panel.label + ' nao respondeu: ' + (response?.error || 'sem resposta');
        }
      });
    }

    $('inworldApiKey').addEventListener('input', (event) =>
      patchSettingsDebounced({ inworldApiKey: event.target.value.trim() })
    );
    $('inworldVoiceId').addEventListener('change', (event) =>
      patchSettings({ inworldVoiceId: event.target.value })
    );
    $('inworldModel').addEventListener('change', (event) =>
      patchSettings({ inworldModel: event.target.value })
    );
    $('testInworldBtn').addEventListener('click', async () => {
      const hint = $('inworldHint');
      hint.textContent = 'Testando...';
      const response = await send({
        type: MSG.INWORLD_TEST,
        apiKey: $('inworldApiKey').value.trim(),
        language: baseLang(settings.targetLang)
      });
      if (response?.ok) {
        inworldVoices = response.voices || [];
        chrome.storage.local.set({ [INWORLD_CACHE_KEY]: inworldVoices });
        renderInworldVoices();
        hint.textContent =
          inworldVoices.length + ' voz(es) em ' + settings.targetLang + ' disponiveis na conta';
      } else {
        hint.textContent = response?.error || 'sem resposta';
      }
    });

    $('elevenApiKey').addEventListener('input', (event) =>
      patchSettingsDebounced({ elevenApiKey: event.target.value.trim() })
    );
    $('elevenVoiceId').addEventListener('change', (event) =>
      patchSettings({ elevenVoiceId: event.target.value })
    );
    $('elevenModel').addEventListener('change', (event) =>
      patchSettings({ elevenModel: event.target.value })
    );
    $('testElevenBtn').addEventListener('click', async () => {
      const hint = $('elevenHint');
      hint.textContent = 'Testando...';
      const response = await send({
        type: MSG.ELEVEN_TEST,
        apiKey: $('elevenApiKey').value.trim()
      });
      if (response?.ok) {
        elevenVoices = response.voices || [];
        chrome.storage.local.set({ [VOICE_CACHE_KEY]: elevenVoices });
        renderElevenVoices();
        const quota = response.quota;
        hint.textContent =
          'Plano ' + quota.tier + ' · restam ' + quota.remaining.toLocaleString('pt-BR') +
          ' de ' + quota.limit.toLocaleString('pt-BR') + ' caracteres';
      } else {
        hint.textContent = response?.error || 'sem resposta';
      }
    });

    $('deepgramSttModel').addEventListener('change', (event) =>
      patchSettings({ deepgramSttModel: event.target.value })
    );
    $('deepgramVoice').addEventListener('change', (event) =>
      patchSettings({ deepgramVoice: event.target.value })
    );
    $('deepgramApiKey').addEventListener('input', (event) =>
      patchSettingsDebounced({ deepgramApiKey: event.target.value.trim() })
    );
    $('testKeyBtn').addEventListener('click', async () => {
      const hint = $('keyHint');
      hint.textContent = 'Testando...';
      const response = await send({
        type: MSG.VALIDATE_KEY,
        apiKey: $('deepgramApiKey').value.trim()
      });
      hint.textContent = response?.ok
        ? 'Chave valida' + (response.projects?.length ? ' · ' + response.projects.join(', ') : '')
        : 'Chave invalida: ' + (response?.error || 'sem resposta');
    });

    $('originalVolume').addEventListener('input', (event) => {
      const value = Number(event.target.value) / 100;
      $('originalVolumeValue').textContent = event.target.value + '%';
      patchSettingsDebounced({ originalVolume: value });
    });
    $('dubVolume').addEventListener('input', (event) => {
      const value = Number(event.target.value) / 100;
      $('dubVolumeValue').textContent = event.target.value + '%';
      patchSettingsDebounced({ dubVolume: value });
    });
    $('maxSpeedup').addEventListener('input', (event) => {
      const value = Number(event.target.value) / 100;
      $('maxSpeedupValue').textContent = value.toFixed(2) + 'x';
      patchSettingsDebounced({ maxSpeedup: value });
    });

    $('prefetchNext').addEventListener('change', (event) =>
      patchSettings({ prefetchNext: Number(event.target.value) })
    );
    $('cacheMaxDubs').addEventListener('change', (event) =>
      patchSettings({ cacheMaxDubs: Number(event.target.value) })
    );

    for (const id of [
      'autoEnable',
      'autoDub',
      'startFromPlayhead',
      'showOverlay',
      'piperCuda',
      'kokoroCuda',
      'f5Cuda'
    ]) {
      $(id).addEventListener('change', (event) => patchSettings({ [id]: event.target.checked }));
    }

    $('clearCacheBtn').addEventListener('click', async () => {
      await send({ type: MSG.CLEAR_CACHE });
      manifest = null;
      renderStatus();
      renderCache();
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== MSG.JOB_PROGRESS) return;
    if (tabId && message.tabId && message.tabId !== tabId) return;
    progress = message;
    running = !(
      !message.prefetch &&
      [STATUS.DONE, STATUS.ERROR, STATUS.CANCELED].includes(message.status)
    );
    if (message.status === STATUS.DONE && !message.prefetch) {
      send({ type: MSG.GET_MANIFEST, key: message.key }).then((response) => {
        if (response?.manifest) manifest = response.manifest;
        renderStatus();
        renderCache();
      });
    }
    renderStatus();
  });

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id || null;

    const cached = await chrome.storage.local.get([VOICE_CACHE_KEY, INWORLD_CACHE_KEY]);
    elevenVoices = cached[VOICE_CACHE_KEY] || [];
    inworldVoices = cached[INWORLD_CACHE_KEY] || [];

    const state = await send({ type: MSG.GET_STATE, tabId });
    if (state?.ok) {
      settings = state.settings;
      engines = state.engines;
      lecture = state.lecture;
      manifest = state.manifest;
      running = state.running;
      progress = state.progress;
      playerEnabled = Boolean(state.enabled);
    }

    bind();
    renderSettings();
    renderEngines();
    renderStatus();
    renderCache();
    refreshSelectedLocal();
  }

  init();
})();
