/*
 * Paineis de ajuste dos motores, gerados a partir do catalogo.
 *
 * Antes cada motor tinha um bloco escrito a mao no HTML, com quinze ids fixos,
 * mais uma entrada correspondente na tabela LOCAL_PANELS do JavaScript. Sete
 * motores, sete blocos, e toda adicao exigia acertar os dois lados sem errar
 * um id, porque errar so aparecia como painel mudo em tempo de execucao.
 *
 * Agora o painel e derivado do descritor do motor. Adicionar um motor ao
 * catalogo faz o painel aparecer sozinho, com os campos declarados.
 */

import type { LocalTtsEngineId, TtsEngineId } from '../../../domain/value-objects/EngineId.ts';
import { isLocalTtsEngineId } from '../../../domain/value-objects/EngineId.ts';
import type {
  EngineField,
  TtsEngineDescriptor
} from '../../../infrastructure/catalog/engines.catalog.ts';
import { TTS_ENGINE_CATALOG } from '../../../infrastructure/catalog/engines.catalog.ts';
import { el } from './dom.ts';

export interface EnginePanelHandlers {
  readonly onSettingChange: (setting: string, value: string | boolean) => void;
  readonly onTest: (engine: TtsEngineId) => void;
  readonly onStartServer: (engine: LocalTtsEngineId) => void;
  readonly onStopServer: (engine: LocalTtsEngineId) => void;
}

/** Controles de um painel, para o presenter atualizar sem procurar por id. */
export interface EnginePanel {
  readonly engine: TtsEngineId;
  readonly root: HTMLElement;
  readonly inputs: ReadonlyMap<string, HTMLInputElement | HTMLSelectElement>;
  readonly datalists: ReadonlyMap<string, HTMLDataListElement>;
  readonly hint: HTMLElement;
  /** Presentes so nos motores locais. */
  readonly serverDot: HTMLElement | null;
  readonly serverState: HTMLElement | null;
  readonly startButton: HTMLButtonElement | null;
  readonly stopButton: HTMLButtonElement | null;
}

function buildField(
  descriptor: TtsEngineDescriptor,
  field: EngineField,
  handlers: EnginePanelHandlers,
  inputs: Map<string, HTMLInputElement | HTMLSelectElement>,
  datalists: Map<string, HTMLDataListElement>
): HTMLElement {
  if (field.kind === 'checkbox') {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => handlers.onSettingChange(field.setting, input.checked));
    inputs.set(field.setting, input);
    return el('label', { class: 'check' }, [input, el('span', {}, [field.hint ?? field.label])]);
  }

  if (field.kind === 'select') {
    const select = el('select');
    select.addEventListener('change', () => handlers.onSettingChange(field.setting, select.value));
    inputs.set(field.setting, select);
    return el('label', { class: 'field' }, [el('span', {}, [field.label]), select]);
  }

  const input = el('input', {
    type: field.kind === 'password' ? 'password' : 'text',
    spellcheck: 'false',
    autocomplete: 'off'
  });
  input.addEventListener('input', () =>
    handlers.onSettingChange(field.setting, input.value.trim())
  );
  inputs.set(field.setting, input);

  // campos de texto livre ganham sugestoes vindas do proprio servidor
  const list = el('datalist', { id: `list-${field.setting}` });
  datalists.set(field.setting, list);
  input.setAttribute('list', list.id);

  // o botao Testar fica ao lado do primeiro campo, que e a URL ou a credencial
  const isPrimary = descriptor.fields[0]?.setting === field.setting;
  const control = isPrimary
    ? el('span', { class: 'withbtn' }, [input, buildTestButton(descriptor, handlers), list])
    : el('span', { class: 'withbtn' }, [input, list]);

  return el('label', { class: 'field' }, [el('span', {}, [field.label]), control]);
}

function buildTestButton(
  descriptor: TtsEngineDescriptor,
  handlers: EnginePanelHandlers
): HTMLButtonElement {
  const button = el('button', { class: 'btn small', type: 'button' }, ['Testar']);
  button.addEventListener('click', () => handlers.onTest(descriptor.id));
  return button;
}

function buildServerControls(
  engine: LocalTtsEngineId,
  handlers: EnginePanelHandlers
): {
  block: HTMLElement;
  dot: HTMLElement;
  state: HTMLElement;
  start: HTMLButtonElement;
  stop: HTMLButtonElement;
} {
  const dot = el('span', { class: 'dot' });
  const state = el('span', {}, ['verificando...']);

  const start = el('button', { class: 'btn small', type: 'button' }, ['Ligar servidor']);
  start.addEventListener('click', () => handlers.onStartServer(engine));

  const stop = el('button', { class: 'btn small', type: 'button' }, ['Desligar']);
  stop.addEventListener('click', () => handlers.onStopServer(engine));

  const block = el('div', {}, [
    el('div', { class: 'status' }, [dot, state]),
    el('div', { class: 'actions' }, [start, stop])
  ]);

  return { block, dot, state, start, stop };
}

export function buildEnginePanels(
  container: HTMLElement,
  handlers: EnginePanelHandlers
): Map<TtsEngineId, EnginePanel> {
  const panels = new Map<TtsEngineId, EnginePanel>();
  container.replaceChildren();

  for (const descriptor of TTS_ENGINE_CATALOG) {
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const datalists = new Map<string, HTMLDataListElement>();
    const hint = el('p', { class: 'hint' }, [descriptor.hint]);

    const children: HTMLElement[] = [];
    const server = isLocalTtsEngineId(descriptor.id)
      ? buildServerControls(descriptor.id, handlers)
      : null;

    descriptor.fields.forEach((field, index) => {
      children.push(buildField(descriptor, field, handlers, inputs, datalists));
      // os controles do servidor vem logo depois da URL, que e o primeiro campo
      if (server && index === 0) children.push(server.block);
    });

    if (descriptor.fields.length === 0) {
      children.push(el('p', { class: 'hint' }, ['Este motor nao tem ajustes.']));
    }

    const root = el('div', { class: 'engine-panel', 'data-engine': descriptor.id }, [
      ...children,
      hint
    ]);
    root.hidden = true;
    container.appendChild(root);

    panels.set(descriptor.id, {
      engine: descriptor.id,
      root,
      inputs,
      datalists,
      hint,
      serverDot: server?.dot ?? null,
      serverState: server?.state ?? null,
      startButton: server?.start ?? null,
      stopButton: server?.stop ?? null
    });
  }

  return panels;
}
