/*
 * Desenho do popup.
 *
 * Recebe um snapshot e atualiza a tela. Nao decide nada, nao fala com o worker
 * e nao guarda estado alem das referencias aos nos.
 */

import { JobStatus } from '../../../domain/entities/JobStatus.ts';
import type { LocalTtsEngineId, TtsEngineId } from '../../../domain/value-objects/EngineId.ts';
import { isLocalTtsEngineId } from '../../../domain/value-objects/EngineId.ts';
import type { LocalServerStatus } from '../../../application/ports/LocalServerControlPort.ts';
import {
  TTS_ENGINE_CATALOG,
  describeEngine
} from '../../../infrastructure/catalog/engines.catalog.ts';
import {
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES
} from '../../../infrastructure/catalog/languages.catalog.ts';
import {
  DEEPGRAM_VOICES,
  INWORLD_MODELS,
  INWORLD_PT_VOICES,
  KOKORO_PT_VOICES
} from '../../../infrastructure/catalog/voices.catalog.ts';
import { baseLanguage } from '../../../domain/value-objects/LanguageCode.ts';
import type { PopupSnapshot } from '../presenter/PopupPresenter.ts';
import type { EnginePanel } from './EnginePanels.ts';
import { el, fillDatalist, fillSelect, need, type SelectOption } from './dom.ts';

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

/** Catalogo local de vozes por motor, usado enquanto a API nao foi consultada. */
const FALLBACK_VOICES: Partial<Record<TtsEngineId, readonly SelectOption[]>> = {
  kokoro: KOKORO_PT_VOICES,
  inworld: INWORLD_PT_VOICES
};

export class PopupView {
  readonly #panels: Map<TtsEngineId, EnginePanel>;

  constructor(panels: Map<TtsEngineId, EnginePanel>) {
    this.#panels = panels;
    this.#fillStaticSelects();
  }

  #fillStaticSelects(): void {
    fillSelect(
      need<HTMLSelectElement>('ttsEngine'),
      TTS_ENGINE_CATALOG.map((engine) => ({ code: engine.id, label: engine.label })),
      ''
    );
  }

  render(snapshot: PopupSnapshot, activeEngine: TtsEngineId): void {
    this.#renderHeader(snapshot, activeEngine);
    this.#renderStatus(snapshot);
    this.#renderSettings(snapshot);
    this.#renderPanels(snapshot, activeEngine);
    this.#renderCache(snapshot);
  }

  // ------------------------------------------------------------------ cabecalho

  #renderHeader(snapshot: PopupSnapshot, activeEngine: TtsEngineId): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('#providerToggle button')) {
      const pressed = button.dataset['provider'] === snapshot.settings.provider;
      button.setAttribute('aria-pressed', String(pressed));
    }

    const chosen = describeEngine(activeEngine);
    need<HTMLSelectElement>('ttsEngine').value =
      snapshot.settings.ttsEngine === 'auto' ? activeEngine : snapshot.settings.ttsEngine;

    const stt = snapshot.engines?.sttProvider;
    need('providerHint').textContent = snapshot.engines
      ? [
          `Texto: ${stt === 'deepgram' ? `Deepgram ${snapshot.settings.deepgramSttModel}` : 'legendas da Udemy'}`,
          'Traducao: Google',
          chosen.hint
        ].join(' · ')
      : '';

    const warn = need('providerWarn');
    const notes = snapshot.engines?.notes ?? [];
    warn.hidden = notes.length === 0;
    warn.textContent = notes.join(' ');

    need('engineBadge').textContent = `${chosen.label} · ${snapshot.settings.targetLang}`;

    const lecture = need('lecture');
    lecture.textContent = snapshot.lecture
      ? snapshot.lecture.title || `Aula ${snapshot.lecture.lectureId}`
      : 'Abra uma aula da Udemy';
    lecture.title = snapshot.lecture?.title ?? '';
  }

  // -------------------------------------------------------------------- status

  #renderStatus(snapshot: PopupSnapshot): void {
    const { progress, manifest, running } = snapshot;
    const status = progress?.status ?? (manifest ? JobStatus.DONE : JobStatus.IDLE);
    const total = progress?.total ?? manifest?.total ?? 0;
    const done = progress?.done ?? manifest?.ready ?? 0;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const isPrefetch = Boolean(progress?.prefetch);

    need('statusText').textContent = running
      ? isPrefetch
        ? 'Adiantando proximas aulas'
        : (STATUS_LABEL[status] ?? 'Trabalhando')
      : manifest
        ? 'Dublagem pronta'
        : status === JobStatus.ERROR
          ? 'Erro'
          : 'Sem dublagem nesta aula';

    need('statusCount').textContent = total > 0 ? `${done}/${total} (${percent}%)` : '';
    need('progressBar').style.width = `${running || manifest ? percent : 0}%`;

    need('statusDot').dataset['state'] = running
      ? 'working'
      : status === JobStatus.ERROR
        ? 'error'
        : manifest
          ? 'ready'
          : 'idle';

    const prefetchHint = need('prefetchHint');
    prefetchHint.hidden = !isPrefetch;
    if (isPrefetch && progress) {
      prefetchHint.textContent =
        `Adiantando ${progress.prefetchIndex ?? 1}/${progress.prefetchTotal ?? 1}: ` +
        (progress.prefetchTitle ?? 'proxima aula');
    }

    need('jobHint').textContent = this.#hints(snapshot, status, isPrefetch).join(' · ');

    const start = need<HTMLButtonElement>('startBtn');
    start.textContent = running ? 'Cancelar' : manifest ? 'Refazer dublagem' : 'Dublar esta aula';
    start.disabled = !snapshot.lecture;
    start.classList.toggle('primary', !running);

    const toggle = need<HTMLButtonElement>('toggleBtn');
    toggle.disabled = !manifest;
    toggle.textContent = snapshot.playerEnabled ? 'Desativar no player' : 'Ativar no player';
    toggle.classList.toggle('active', snapshot.playerEnabled);
  }

  #hints(snapshot: PopupSnapshot, status: string, isPrefetch: boolean): string[] {
    const { progress, manifest, running } = snapshot;
    const hints: string[] = [];

    if (progress?.message && running && !isPrefetch) hints.push(progress.message);
    if (status === JobStatus.ERROR && progress?.message) hints.push(progress.message);
    if (progress?.failures) hints.push(`${progress.failures} trecho(s) falharam`);

    if (manifest && !running) {
      const origem = manifest.sttProvider === 'deepgram' ? 'Deepgram' : 'legendas';
      hints.push(`Voz: ${manifest.voice ?? manifest.ttsEngine} · origem do texto: ${origem}`);
    }

    hints.push(...(manifest?.notes ?? []));
    return hints;
  }

  // ---------------------------------------------------------------- ajustes

  #renderSettings(snapshot: PopupSnapshot): void {
    const settings = snapshot.settings;

    fillSelect(need<HTMLSelectElement>('sourceLang'), SOURCE_LANGUAGES, settings.sourceLang);
    fillSelect(need<HTMLSelectElement>('targetLang'), TARGET_LANGUAGES, settings.targetLang);

    need<HTMLSelectElement>('deepgramSttModel').value = settings.deepgramSttModel;
    need<HTMLInputElement>('deepgramApiKey').value = settings.deepgramApiKey;

    need<HTMLSelectElement>('prefetchNext').value = String(settings.prefetchNext);
    need<HTMLSelectElement>('cacheMaxDubs').value = String(settings.cacheMaxDubs);

    setRange(
      'originalVolume',
      'originalVolumeValue',
      settings.originalVolume,
      (value) => `${Math.round(value * 100)}%`
    );
    setRange(
      'dubVolume',
      'dubVolumeValue',
      settings.dubVolume,
      (value) => `${Math.round(value * 100)}%`
    );
    setRange(
      'maxSpeedup',
      'maxSpeedupValue',
      settings.maxSpeedup,
      (value) => `${value.toFixed(2)}x`
    );

    for (const id of ['autoEnable', 'autoDub', 'startFromPlayhead', 'showOverlay'] as const) {
      need<HTMLInputElement>(id).checked = settings[id];
    }
  }

  // ----------------------------------------------------------------- paineis

  #renderPanels(snapshot: PopupSnapshot, activeEngine: TtsEngineId): void {
    for (const [engine, panel] of this.#panels) {
      panel.root.hidden = engine !== activeEngine;
      if (engine !== activeEngine) continue;

      for (const [setting, input] of panel.inputs) {
        const value = snapshot.settings[setting as keyof typeof snapshot.settings];

        if (input instanceof HTMLInputElement && input.type === 'checkbox') {
          input.checked = Boolean(value);
          continue;
        }

        if (input instanceof HTMLSelectElement) {
          fillSelect(input, this.#voicesFor(engine, setting, snapshot), String(value ?? ''));
          continue;
        }

        // nao sobrescrever enquanto o usuario digita
        if (document.activeElement !== input) input.value = String(value ?? '');
      }
    }
  }

  /** Vozes de um seletor: as da API quando ja consultadas, senao o catalogo. */
  #voicesFor(
    engine: TtsEngineId,
    setting: string,
    snapshot: PopupSnapshot
  ): readonly SelectOption[] {
    if (setting === 'inworldModel') return INWORLD_MODELS;

    if (engine === 'deepgram') {
      const voices = DEEPGRAM_VOICES[baseLanguage(snapshot.settings.targetLang)] ?? [];
      return voices.length > 0
        ? voices.map((voice) => ({
            code: voice,
            label: voice.replace('aura-2-', '').replace(/-(\w+)$/, ' ($1)')
          }))
        : [{ code: '', label: 'sem voz para este idioma' }];
    }

    const remote = snapshot.remoteVoices[engine];
    if (remote?.length) {
      return remote.map((voice) => ({
        code: voice.id,
        label: voice.description ? `${voice.name} — ${voice.description.slice(0, 40)}` : voice.name
      }));
    }

    const fallback = FALLBACK_VOICES[engine];
    if (fallback) return fallback;

    const current = String(snapshot.settings[setting as keyof typeof snapshot.settings] ?? '');
    return [{ code: current, label: current || 'clique em Testar para listar' }];
  }

  /** Vozes que o servidor local listou viram sugestoes do campo de texto. */
  setLocalVoiceSuggestions(engine: LocalTtsEngineId, setting: string, voices: string[]): void {
    const list = this.#panels.get(engine)?.datalists.get(setting);
    if (list) fillDatalist(list, voices);
  }

  setPanelHint(engine: TtsEngineId, message: string): void {
    const panel = this.#panels.get(engine);
    if (panel) panel.hint.textContent = message;
  }

  renderServerStatus(engine: TtsEngineId, status: LocalServerStatus): void {
    if (!isLocalTtsEngineId(engine)) return;
    const panel = this.#panels.get(engine);
    if (!panel?.serverDot || !panel.serverState) return;

    let label: string;
    let state: string;

    if (status.missing) {
      label = 'controle nao instalado — rode tools\\install-native-host.ps1';
      state = 'error';
    } else if (!status.ok) {
      label = status.error ?? 'sem resposta do controle';
      state = 'error';
    } else if (status.running) {
      label = `no ar na porta ${status.port}${status.device ? ` · ${status.device}` : ''}`;
      state = 'ready';
    } else {
      label = 'servidor desligado';
      state = 'idle';
    }

    panel.serverState.textContent = label;
    panel.serverDot.dataset['state'] = state;
    if (panel.startButton) panel.startButton.disabled = status.running;
    if (panel.stopButton) panel.stopButton.disabled = !status.running;
  }

  setServerBusy(engine: TtsEngineId, message: string): void {
    if (!isLocalTtsEngineId(engine)) return;
    const panel = this.#panels.get(engine);
    if (!panel?.serverDot || !panel.serverState) return;

    panel.serverState.textContent = message;
    panel.serverDot.dataset['state'] = 'working';
    if (panel.startButton) panel.startButton.disabled = true;
    if (panel.stopButton) panel.stopButton.disabled = true;
  }

  // ------------------------------------------------------------------- cache

  #renderCache(snapshot: PopupSnapshot): void {
    const list = need<HTMLUListElement>('dubList');
    need('cacheCount').textContent =
      snapshot.dubs.length > 0 ? `${snapshot.dubs.length} aula(s)` : '';

    if (snapshot.dubs.length === 0) {
      list.replaceChildren(el('li', { class: 'empty' }, ['Nada salvo ainda']));
    } else {
      list.replaceChildren(
        ...snapshot.dubs.map((dub) => {
          const title = dub.title || `Aula ${dub.lectureId}`;
          const remove = el('button', { class: 'del', title: 'Apagar' }, ['×']);
          remove.dataset['key'] = dub.key;

          return el('li', {}, [
            el('span', { class: 'name', title }, [title]),
            el('span', { class: 'meta' }, [
              `${dub.ready}/${dub.total} · ${String(dub.ttsEngine).slice(0, 6)}`
            ]),
            remove
          ]);
        })
      );
    }

    need('usageHint').textContent = snapshot.usage
      ? `${(snapshot.usage.usage / 1048576).toFixed(1)} MB em cache`
      : '';
  }
}

function setRange(
  inputId: string,
  labelId: string,
  value: number,
  format: (value: number) => string
): void {
  const input = need<HTMLInputElement>(inputId);
  if (document.activeElement !== input) input.value = String(Math.round(value * 100));
  need(labelId).textContent = format(value);
}
