/*
 * Composition root do popup.
 *
 * Liga os controles do HTML ao presenter e o presenter a view. A funcao bind()
 * de 222 linhas da versao anterior sumiu: os paineis de motor sao gerados a
 * partir do catalogo, ja com os listeners, e o que sobra aqui sao os controles
 * fixos da tela.
 */

import type { LocalTtsEngineId, TtsEngineId } from '../../domain/value-objects/EngineId.ts';
import { isLocalTtsEngineId } from '../../domain/value-objects/EngineId.ts';
import type { SettingsPatch } from '../../application/dto/Settings.ts';
import { ConsoleLogger } from '../../infrastructure/logging/ConsoleLogger.ts';
import { MSG } from '../../infrastructure/messaging/contracts.ts';
import { MessageBus } from '../../infrastructure/messaging/MessageBus.ts';
import {
  LOCAL_SETTING_KEYS,
  describeEngine
} from '../../infrastructure/catalog/engines.catalog.ts';
import { PopupPresenter } from './presenter/PopupPresenter.ts';
import { buildEnginePanels } from './views/EnginePanels.ts';
import { PopupView } from './views/PopupView.ts';
import { need } from './views/dom.ts';

/** Digitar uma URL nao pode disparar uma gravacao por tecla. */
const TYPING_DEBOUNCE_MS = 300;

const logger = new ConsoleLogger('popup');
const bus = new MessageBus(logger);
const presenter = new PopupPresenter(bus);

function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  wait: number
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

const patchDebounced = debounce(
  (patch: SettingsPatch) => void presenter.patchSettings(patch),
  TYPING_DEBOUNCE_MS
);

// ------------------------------------------------------------------- paineis

const panels = buildEnginePanels(need('enginePanels'), {
  onSettingChange: (setting, value) => {
    const patch = { [setting]: value } as SettingsPatch;
    if (typeof value === 'boolean') void presenter.patchSettings(patch);
    else patchDebounced(patch);
  },
  onTest: (engine) => void runTest(engine),
  onStartServer: (engine) => void controlServer(engine, 'start'),
  onStopServer: (engine) => void controlServer(engine, 'stop')
});

const view = new PopupView(panels);

// -------------------------------------------------------------------- acoes

async function runTest(engine: TtsEngineId): Promise<void> {
  const label = describeEngine(engine).label;
  view.setPanelHint(engine, `Testando ${label}...`);

  const result = await presenter.testCredential(engine);

  if (!result.ok) {
    view.setPanelHint(engine, `${label} nao respondeu: ${result.error ?? 'sem resposta'}`);
    return;
  }

  const parts = [`${label} respondeu`];
  if (result.device) parts.push(result.device);
  if (result.quota) {
    parts.push(
      `plano ${result.quota.tier} · restam ${result.quota.remaining.toLocaleString('pt-BR')} de ` +
        `${result.quota.limit.toLocaleString('pt-BR')} caracteres`
    );
  }
  if (result.voices?.length) parts.push(`${result.voices.length} voz(es)`);
  if (result.projects?.length) parts.push(result.projects.join(', '));

  view.setPanelHint(engine, parts.join(' · '));

  // servidor local: as vozes viram sugestoes do campo de texto
  if (isLocalTtsEngineId(engine) && result.voices?.length) {
    view.setLocalVoiceSuggestions(
      engine,
      LOCAL_SETTING_KEYS[engine].voice,
      result.voices.map((voice) => voice.id)
    );
  }
}

async function controlServer(engine: LocalTtsEngineId, action: 'start' | 'stop'): Promise<void> {
  view.setServerBusy(
    engine,
    action === 'start' ? 'ligando (carregar o modelo leva alguns segundos)...' : 'desligando...'
  );

  const status =
    action === 'start'
      ? await presenter.startLocalServer(engine)
      : await presenter.stopLocalServer(engine);

  view.renderServerStatus(engine, status);
  // reconsulta: o start responde antes de o modelo terminar de carregar
  view.renderServerStatus(engine, await presenter.localServerStatus(engine));
}

/** Consulta so o servidor do motor selecionado, nao os tres. */
async function refreshSelectedServer(): Promise<void> {
  const engine = presenter.effectiveEngine();
  if (!isLocalTtsEngineId(engine)) return;
  view.renderServerStatus(engine, await presenter.localServerStatus(engine));
}

// --------------------------------------------------------- controles fixos

function bindFixedControls(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('#providerToggle button')) {
    button.addEventListener('click', () => {
      const provider = button.dataset['provider'] as 'deepgram' | 'google';
      void presenter.patchSettings({ provider });
    });
  }

  need<HTMLSelectElement>('ttsEngine').addEventListener('change', (event) => {
    const ttsEngine = (event.target as HTMLSelectElement).value as TtsEngineId;
    void presenter.patchSettings({ ttsEngine }).then(refreshSelectedServer);
  });

  need('startBtn').addEventListener('click', () => void presenter.toggleJob());
  need('toggleBtn').addEventListener('click', () => void presenter.togglePlayer());

  bindSelect('sourceLang', (value) => ({ sourceLang: value }));
  bindSelect('targetLang', (value) => ({ targetLang: value }));
  bindSelect('deepgramSttModel', (value) => ({ deepgramSttModel: value }));
  bindSelect('prefetchNext', (value) => ({ prefetchNext: Number(value) }));
  bindSelect('cacheMaxDubs', (value) => ({ cacheMaxDubs: Number(value) }));

  bindRange(
    'originalVolume',
    'originalVolumeValue',
    (value) => ({ originalVolume: value }),
    (v) => `${Math.round(v * 100)}%`
  );
  bindRange(
    'dubVolume',
    'dubVolumeValue',
    (value) => ({ dubVolume: value }),
    (v) => `${Math.round(v * 100)}%`
  );
  bindRange(
    'maxSpeedup',
    'maxSpeedupValue',
    (value) => ({ maxSpeedup: value }),
    (v) => `${v.toFixed(2)}x`
  );

  for (const id of ['autoEnable', 'autoDub', 'startFromPlayhead', 'showOverlay'] as const) {
    need<HTMLInputElement>(id).addEventListener('change', (event) => {
      void presenter.patchSettings({ [id]: (event.target as HTMLInputElement).checked });
    });
  }

  const deepgramKey = need<HTMLInputElement>('deepgramApiKey');
  deepgramKey.addEventListener('input', () =>
    patchDebounced({ deepgramApiKey: deepgramKey.value.trim() })
  );
  need('testDeepgramKeyBtn').addEventListener('click', () => {
    void presenter.testCredential('deepgram-stt').then((result) => {
      need('deepgramKeyHint').textContent = result.ok
        ? `Chave valida${result.projects?.length ? ` · ${result.projects.join(', ')}` : ''}`
        : `Chave invalida: ${result.error ?? 'sem resposta'}`;
    });
  });

  need('clearCacheBtn').addEventListener('click', () => void presenter.clearCache());

  // delegacao: a lista de dublagens e redesenhada a cada mudanca
  need('dubList').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.del');
    const key = button?.dataset['key'];
    if (key) void presenter.deleteDub(key);
  });
}

function bindSelect(id: string, toPatch: (value: string) => SettingsPatch): void {
  need<HTMLSelectElement>(id).addEventListener('change', (event) => {
    void presenter.patchSettings(toPatch((event.target as HTMLSelectElement).value));
  });
}

function bindRange(
  id: string,
  labelId: string,
  toPatch: (value: number) => SettingsPatch,
  format: (value: number) => string
): void {
  const input = need<HTMLInputElement>(id);
  input.addEventListener('input', () => {
    const value = Number(input.value) / 100;
    need(labelId).textContent = format(value);
    patchDebounced(toPatch(value));
  });
}

// -------------------------------------------------------------------- boot

presenter.onChange((snapshot) => view.render(snapshot, presenter.effectiveEngine()));

bus.on(MSG.JOB_PROGRESS, ({ tabId, progress }) => {
  presenter.onProgress(progress, tabId);
  return {};
});
bus.listen();

bindFixedControls();
void presenter.initialize().then(refreshSelectedServer);
