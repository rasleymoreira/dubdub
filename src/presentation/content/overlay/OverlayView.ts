/*
 * Painel flutuante dentro da aula.
 *
 * Renderizado em Shadow DOM para nao herdar nem contaminar o CSS da Udemy: sem
 * isso qualquer mudanca de estilo do site quebraria o painel, e vice-versa.
 *
 * Vem desligado por padrao. O popup faz o mesmo sem ocupar espaco sobre o video.
 *
 * O conteudo dinamico e montado com nos do DOM, nao com concatenacao de HTML.
 * A versao anterior montava innerHTML com escape manual: funciona ate alguem
 * esquecer de escapar um campo, e titulos de aula vem da pagina.
 */

import { JobStatus } from '../../../domain/entities/JobStatus.ts';

const STATUS_LABEL: Record<string, string> = {
  [JobStatus.IDLE]: 'Parado',
  [JobStatus.CONTEXT]: 'Lendo a aula',
  [JobStatus.TRANSCRIBING]: 'Transcrevendo',
  [JobStatus.TRANSLATING]: 'Traduzindo',
  [JobStatus.SYNTHESIZING]: 'Gerando voz',
  [JobStatus.DONE]: 'Dublagem pronta',
  [JobStatus.ERROR]: 'Erro',
  [JobStatus.CANCELED]: 'Cancelado'
};

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
  .status strong { color: #f2f0f7; font-weight: 600; }
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

const TEMPLATE = `
  <div class="panel" data-collapsed="false">
    <div class="head">
      <span class="dot" data-state="idle"></span>
      <span class="title">dubdub</span>
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

export interface OverlayState {
  readonly running: boolean;
  readonly status: string;
  readonly message: string;
  readonly done: number;
  readonly total: number;
  readonly notes: readonly string[];
  readonly hasDub: boolean;
  readonly enabled: boolean;
  readonly engineLabel: string | null;
  readonly lang: string | null;
  readonly originalVolume: number;
  readonly prefetch: {
    readonly title: string;
    readonly index: number;
    readonly count: number;
  } | null;
}

export interface OverlayHandlers {
  readonly onStart: () => void;
  readonly onCancel: () => void;
  readonly onToggle: () => void;
  readonly onOriginalVolume: (value: number) => void;
}

export class OverlayView {
  readonly #host: HTMLDivElement;
  readonly #shadow: ShadowRoot;
  readonly #handlers: OverlayHandlers;
  #running = false;

  constructor(handlers: OverlayHandlers, visible: boolean) {
    this.#handlers = handlers;

    this.#host = document.createElement('div');
    this.#host.id = 'udub-overlay-host';
    this.#host.style.all = 'initial';
    // nasce escondido: quem manda e a preferencia, e sem isso ele pisca na tela
    if (!visible) this.#host.style.display = 'none';

    this.#shadow = this.#host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    this.#shadow.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = TEMPLATE;
    this.#shadow.appendChild(wrapper);

    (document.body ?? document.documentElement).appendChild(this.#host);
    this.#bind();
  }

  #query<T extends Element>(selector: string): T {
    const element = this.#shadow.querySelector<T>(selector);
    if (!element) throw new Error(`overlay sem o elemento ${selector}`);
    return element;
  }

  #bind(): void {
    const panel = this.#query<HTMLDivElement>('.panel');
    this.#query('.head').addEventListener('click', () => {
      panel.dataset['collapsed'] = panel.dataset['collapsed'] === 'true' ? 'false' : 'true';
    });

    this.#query('.act-start').addEventListener('click', () => {
      if (this.#running) this.#handlers.onCancel();
      else this.#handlers.onStart();
    });

    this.#query('.act-toggle').addEventListener('click', () => this.#handlers.onToggle());

    const volume = this.#query<HTMLInputElement>('.act-volume');
    volume.addEventListener('input', () => {
      this.#query('.vol-value').textContent = `${volume.value}%`;
      this.#handlers.onOriginalVolume(Number(volume.value) / 100);
    });
  }

  render(state: OverlayState): void {
    this.#running = state.running;

    this.#renderStatus(state);
    this.#renderProgress(state);
    this.#renderButtons(state);
    this.#renderVolume(state);
    this.#renderMeta(state);
    this.#renderNotes(state);
    this.#renderPrefetch(state);
  }

  #renderStatus(state: OverlayState): void {
    const status = this.#query('.status');
    status.replaceChildren();

    const strong = document.createElement('strong');

    if (state.running) {
      strong.textContent = STATUS_LABEL[state.status] ?? 'Trabalhando';
      status.append(strong);
      if (state.total > 0) status.append(` · ${state.done}/${state.total}`);
      else if (state.message) status.append(` · ${state.message}`);
      return;
    }

    if (state.enabled) strong.textContent = 'Dublagem ativa';
    else if (state.hasDub) strong.textContent = 'Dublagem pronta';
    else if (state.status === JobStatus.ERROR) strong.textContent = 'Erro';
    else strong.textContent = 'Sem dublagem para esta aula';

    status.append(strong);
    if (state.status === JobStatus.ERROR && state.message) status.append(` · ${state.message}`);
  }

  #renderProgress(state: OverlayState): void {
    const percent = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
    const width = state.running || state.hasDub ? percent || (state.hasDub ? 100 : 0) : 0;
    this.#query<HTMLElement>('.bar i').style.width = `${width}%`;

    const dot = this.#query<HTMLElement>('.dot');
    dot.dataset['state'] = state.running
      ? 'working'
      : state.status === JobStatus.ERROR
        ? 'error'
        : state.enabled
          ? 'on'
          : state.hasDub
            ? 'ready'
            : 'idle';
  }

  #renderButtons(state: OverlayState): void {
    const start = this.#query<HTMLButtonElement>('.act-start');
    start.textContent = state.running ? 'Cancelar' : state.hasDub ? 'Redublar' : 'Dublar aula';
    start.classList.toggle('primary', !state.running);

    const toggle = this.#query<HTMLButtonElement>('.act-toggle');
    toggle.disabled = !state.hasDub;
    toggle.textContent = state.enabled ? 'Desativar' : 'Ativar';
    toggle.classList.toggle('active', state.enabled);
  }

  #renderVolume(state: OverlayState): void {
    const volume = this.#query<HTMLInputElement>('.act-volume');
    // nao sobrescrever enquanto o usuario arrasta o controle
    if (this.#shadow.activeElement === volume) return;

    volume.value = String(Math.round(state.originalVolume * 100));
    this.#query('.vol-value').textContent = `${volume.value}%`;
  }

  #renderMeta(state: OverlayState): void {
    const meta = this.#query('.meta');
    const tags: string[] = [];
    if (state.engineLabel) tags.push(state.engineLabel);
    if (state.lang) tags.push(state.lang);
    if (state.hasDub && state.total > 0) tags.push(`${state.total} trechos`);

    meta.replaceChildren(
      ...tags.map((text) => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = text;
        return span;
      })
    );
  }

  #renderNotes(state: OverlayState): void {
    this.#query('.notes').replaceChildren(
      ...state.notes.slice(0, 3).map((note) => {
        const item = document.createElement('li');
        item.textContent = note;
        return item;
      })
    );
  }

  #renderPrefetch(state: OverlayState): void {
    const prefetch = this.#query<HTMLElement>('.prefetch');
    prefetch.hidden = state.prefetch === null;
    if (!state.prefetch) return;

    const label = this.#query('.prefetch .label');
    label.textContent = `Adiantando: ${state.prefetch.title || 'proxima aula'}`;
    (label as HTMLElement).title = state.prefetch.title;
    this.#query('.prefetch .count').textContent =
      `${state.prefetch.index} de ${state.prefetch.count}`;
  }

  show(): void {
    this.#host.style.display = 'block';
  }

  hide(): void {
    this.#host.style.display = 'none';
  }

  destroy(): void {
    this.#host.remove();
  }
}
