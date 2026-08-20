/*
 * HUD dentro da pagina da Udemy. Renderizado em Shadow DOM para nao herdar
 * (nem quebrar) o CSS da Udemy.
 */

var UDUB_Overlay = (function () {
  'use strict';

  const { STATUS_LABEL } = globalThis.UDUB;

  const CSS = `
    :host { all: initial; }
    .panel {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      width: 288px; box-sizing: border-box;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #f2f0f7; background: #1f1e26; border: 1px solid #332f3d;
      border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.45);
      font-size: 12px; line-height: 1.45; overflow: hidden;
    }
    .panel[data-collapsed="true"] .body { display: none; }
    .head {
      display: flex; align-items: center; gap: 8px; padding: 8px 10px;
      background: #16151a; border-bottom: 1px solid #332f3d; cursor: pointer;
    }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: #a09bb0; flex: none; }
    .dot[data-state="working"] { background: #f59e0b; animation: pulse 1.2s infinite; }
    .dot[data-state="ready"] { background: #10b981; }
    .dot[data-state="on"] { background: #a435f0; }
    .dot[data-state="error"] { background: #ef4444; }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
    .title { font-weight: 600; font-size: 12px; flex: 1; }
    .chev { color: #a09bb0; font-size: 11px; }
    .body { padding: 10px; display: grid; gap: 8px; }
    .status { color: #a09bb0; }
    .status b { color: #f2f0f7; font-weight: 600; }
    .bar { height: 4px; border-radius: 999px; background: #332f3d; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0%; background: #a435f0; transition: width .25s ease; }
    .row { display: flex; gap: 6px; }
    button {
      font: inherit; color: inherit; border: 1px solid #332f3d; background: #16151a;
      padding: 6px 10px; border-radius: 8px; cursor: pointer; flex: 1;
      transition: background .15s ease, border-color .15s ease;
    }
    button:hover:not(:disabled) { background: #2a2833; }
    button:disabled { opacity: .5; cursor: default; }
    button.primary { background: #a435f0; border-color: #a435f0; font-weight: 600; }
    button.primary:hover:not(:disabled) { background: #8710d8; }
    button.active { border-color: #a435f0; color: #d9b6ff; }
    .vol { display: flex; align-items: center; gap: 8px; color: #a09bb0; }
    .vol input { flex: 1; accent-color: #a435f0; }
    .notes { margin: 0; padding-left: 14px; color: #f59e0b; display: grid; gap: 2px; }
    .notes:empty { display: none; }
    .prefetch {
      display: flex; align-items: center; gap: 6px; color: #22d3ee;
      border-top: 1px solid #332f3d; padding-top: 7px; font-size: 11px;
    }
    .prefetch[hidden] { display: none; }
    .prefetch .spin {
      width: 7px; height: 7px; border-radius: 999px; background: #22d3ee;
      animation: pulse 1.2s infinite; flex: none;
    }
    .prefetch .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { color: #a09bb0; font-size: 11px; display: flex; gap: 6px; flex-wrap: wrap; }
    .tag { border: 1px solid #332f3d; border-radius: 999px; padding: 1px 7px; }
  `;

  const HTML = `
    <div class="panel" data-collapsed="false">
      <div class="head" part="head">
        <span class="dot" data-state="idle"></span>
        <span class="title">Dub PT-BR</span>
        <span class="chev">&#9662;</span>
      </div>
      <div class="body">
        <div class="status"></div>
        <div class="bar"><i></i></div>
        <div class="row">
          <button class="primary act-start">Dublar aula</button>
          <button class="act-toggle" disabled>Ativar</button>
        </div>
        <div class="vol">
          <span>Original</span>
          <input class="act-volume" type="range" min="0" max="100" step="5" value="0">
          <span class="vol-value">0%</span>
        </div>
        <div class="meta"></div>
        <ul class="notes"></ul>
        <div class="prefetch" hidden>
          <span class="spin"></span>
          <span class="label"></span>
          <span class="count"></span>
        </div>
      </div>
    </div>
  `;

  function create(handlers) {
    const host = document.createElement('div');
    host.id = 'udub-overlay-host';
    host.style.all = 'initial';
    // nasce escondido: quem manda e a preferencia, sem piscar na tela
    if (handlers.visible !== true) host.style.display = 'none';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = HTML;
    shadow.appendChild(wrapper);
    (document.body || document.documentElement).appendChild(host);

    const panel = shadow.querySelector('.panel');
    const dot = shadow.querySelector('.dot');
    const status = shadow.querySelector('.status');
    const bar = shadow.querySelector('.bar i');
    const startButton = shadow.querySelector('.act-start');
    const toggleButton = shadow.querySelector('.act-toggle');
    const volume = shadow.querySelector('.act-volume');
    const volumeValue = shadow.querySelector('.vol-value');
    const meta = shadow.querySelector('.meta');
    const notes = shadow.querySelector('.notes');
    const prefetch = shadow.querySelector('.prefetch');
    const prefetchLabel = shadow.querySelector('.prefetch .label');
    const prefetchCount = shadow.querySelector('.prefetch .count');

    let running = false;

    shadow.querySelector('.head').addEventListener('click', () => {
      panel.dataset.collapsed = panel.dataset.collapsed === 'true' ? 'false' : 'true';
    });
    startButton.addEventListener('click', () => {
      if (running) handlers.onCancel();
      else handlers.onStart();
    });
    toggleButton.addEventListener('click', () => handlers.onToggle());
    volume.addEventListener('input', () => {
      const value = Number(volume.value) / 100;
      volumeValue.textContent = volume.value + '%';
      handlers.onOriginalVolume(value);
    });

    function render(state) {
      running = Boolean(state.running);

      const label = STATUS_LABEL[state.status] || 'Parado';
      const parts = [];
      if (state.running) {
        parts.push('<b>' + label + '</b>');
        if (state.total) parts.push((state.done || 0) + '/' + state.total);
        if (state.message && !state.total) parts.push(state.message);
      } else if (state.enabled) {
        parts.push('<b>Dublagem ativa</b>');
      } else if (state.hasDub) {
        parts.push('<b>Dublagem pronta</b>');
      } else if (state.status === 'error') {
        parts.push('<b>Erro</b> ' + (state.message || ''));
      } else {
        parts.push('Sem dublagem para esta aula');
      }
      status.innerHTML = parts.join(' &middot; ');

      const percent = state.total ? Math.round(((state.done || 0) / state.total) * 100) : 0;
      bar.style.width = (state.running || state.hasDub ? percent || (state.hasDub ? 100 : 0) : 0) + '%';

      dot.dataset.state = state.running
        ? 'working'
        : state.status === 'error'
          ? 'error'
          : state.enabled
            ? 'on'
            : state.hasDub
              ? 'ready'
              : 'idle';

      startButton.textContent = running ? 'Cancelar' : state.hasDub ? 'Redublar' : 'Dublar aula';
      startButton.classList.toggle('primary', !running);

      toggleButton.disabled = !state.hasDub;
      toggleButton.textContent = state.enabled ? 'Desativar' : 'Ativar';
      toggleButton.classList.toggle('active', Boolean(state.enabled));

      if (typeof state.originalVolume === 'number' && document.activeElement !== volume) {
        volume.value = String(Math.round(state.originalVolume * 100));
        volumeValue.textContent = volume.value + '%';
      }

      const tags = [];
      if (state.engine) tags.push(state.engine === 'deepgram' ? 'Voz Deepgram' : 'Voz Google');
      if (state.lang) tags.push(state.lang);
      if (state.hasDub && state.total) tags.push(state.total + ' trechos');
      meta.innerHTML = tags.map((tag) => '<span class="tag">' + tag + '</span>').join('');

      notes.innerHTML = (state.notes || [])
        .slice(0, 3)
        .map((note) => '<li>' + String(note).replace(/</g, '&lt;') + '</li>')
        .join('');

      prefetch.hidden = !state.prefetch;
      if (state.prefetch) {
        prefetchLabel.textContent = 'Adiantando: ' + (state.prefetch.title || 'proxima aula');
        prefetchLabel.title = state.prefetch.title || '';
        prefetchCount.textContent = state.prefetch.total
          ? state.prefetch.done + '/' + state.prefetch.total
          : state.prefetch.index + ' de ' + state.prefetch.count;
      }
    }

    return {
      render,
      show() {
        host.style.display = 'block';
      },
      hide() {
        host.style.display = 'none';
      },
      destroy() {
        host.remove();
      }
    };
  }

  return { create };
})();
