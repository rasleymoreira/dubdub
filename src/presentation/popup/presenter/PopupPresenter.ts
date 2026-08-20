/*
 * Estado e acoes do popup.
 *
 * O popup anterior tinha 658 linhas com estado em variaveis de modulo e uma
 * funcao bind() de 222 linhas que registrava todos os listeners a mao. O
 * presenter separa as duas coisas: aqui esta o que o popup SABE e o que ele
 * FAZ; a view so desenha o que recebe.
 *
 * Nao ha DOM neste arquivo.
 */

import { JobStatus, isTerminal } from '../../../domain/entities/JobStatus.ts';
import type { Lecture } from '../../../domain/entities/Lecture.ts';
import type { EngineSelection } from '../../../domain/services/EngineResolver.ts';
import type { LocalTtsEngineId, TtsEngineId } from '../../../domain/value-objects/EngineId.ts';
import type { DubManifest, DubSummary } from '../../../application/dto/DubManifest.ts';
import type { JobProgress } from '../../../application/dto/JobProgress.ts';
import type { Settings, SettingsPatch } from '../../../application/dto/Settings.ts';
import type {
  CredentialTestResult,
  RemoteVoice
} from '../../../application/ports/CredentialTestPort.ts';
import type { LocalServerStatus } from '../../../application/ports/LocalServerControlPort.ts';
import type { StorageEstimate } from '../../../application/ports/repositories.ts';
import { DEFAULT_SETTINGS } from '../../../infrastructure/catalog/defaults.ts';
import { MSG } from '../../../infrastructure/messaging/contracts.ts';
import type { MessageBus } from '../../../infrastructure/messaging/MessageBus.ts';
import { unwrap } from '../../../infrastructure/messaging/MessageBus.ts';

/** Vozes descobertas via API ficam guardadas: o popup abre e fecha o tempo todo. */
const VOICE_CACHE_KEY = 'remoteVoiceCache';

type RemoteVoiceCache = Record<string, readonly RemoteVoice[]>;

export interface PopupSnapshot {
  readonly settings: Settings;
  readonly engines: EngineSelection | null;
  readonly lecture: Lecture | null;
  readonly manifest: DubManifest | null;
  readonly running: boolean;
  readonly progress: JobProgress | null;
  readonly playerEnabled: boolean;
  readonly dubs: readonly DubSummary[];
  readonly usage: StorageEstimate | null;
  /** Vozes vindas da API de cada provedor, por motor. */
  readonly remoteVoices: Readonly<Record<string, readonly RemoteVoice[]>>;
}

export type SnapshotListener = (snapshot: PopupSnapshot) => void;

export class PopupPresenter {
  readonly #bus: MessageBus;
  readonly #listeners: SnapshotListener[] = [];
  #tabId: number | null = null;

  #settings: Settings = DEFAULT_SETTINGS;
  #engines: EngineSelection | null = null;
  #lecture: Lecture | null = null;
  #manifest: DubManifest | null = null;
  #running = false;
  #progress: JobProgress | null = null;
  #playerEnabled = false;
  #dubs: readonly DubSummary[] = [];
  #usage: StorageEstimate | null = null;
  #remoteVoices: RemoteVoiceCache = {};

  constructor(bus: MessageBus) {
    this.#bus = bus;
  }

  onChange(listener: SnapshotListener): void {
    this.#listeners.push(listener);
  }

  snapshot(): PopupSnapshot {
    return {
      settings: this.#settings,
      engines: this.#engines,
      lecture: this.#lecture,
      manifest: this.#manifest,
      running: this.#running,
      progress: this.#progress,
      playerEnabled: this.#playerEnabled,
      dubs: this.#dubs,
      usage: this.#usage,
      remoteVoices: this.#remoteVoices
    };
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }

  // -------------------------------------------------------------- carregamento

  async initialize(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    this.#tabId = tab?.id ?? null;

    const cached = await chrome.storage.local.get([VOICE_CACHE_KEY]);
    this.#remoteVoices = (cached[VOICE_CACHE_KEY] as RemoteVoiceCache | undefined) ?? {};

    const state = unwrap(await this.#bus.send(MSG.GET_STATE, { tabId: this.#tabId }));
    if (state) {
      this.#settings = state.settings;
      this.#engines = state.engines;
      this.#lecture = state.lecture;
      this.#manifest = state.manifest;
      this.#running = state.running;
      this.#progress = state.progress;
      this.#playerEnabled = state.enabled;
    }

    this.#emit();
    await this.refreshCache();
  }

  async refreshCache(): Promise<void> {
    const listing = unwrap(await this.#bus.send(MSG.LIST_DUBS, {}));
    this.#dubs = listing?.dubs ?? [];
    this.#usage = listing?.usage ?? null;
    this.#emit();
  }

  // --------------------------------------------------------------- preferencias

  async patchSettings(patch: SettingsPatch): Promise<void> {
    // otimista: o controle ja reflete o valor antes da ida ao worker
    this.#settings = { ...this.#settings, ...patch };
    this.#emit();

    const response = unwrap(await this.#bus.send(MSG.SET_SETTINGS, { patch }));
    if (response) {
      this.#settings = response.settings;
      this.#engines = response.engines;
    }
    this.#emit();
  }

  /** Motor de voz efetivo: o resolvido, ou o pedido quando ainda nao resolveu. */
  effectiveEngine(): TtsEngineId {
    if (this.#engines) return this.#engines.ttsEngine;
    return this.#settings.ttsEngine === 'auto' ? 'google' : this.#settings.ttsEngine;
  }

  // ---------------------------------------------------------------------- jobs

  async toggleJob(): Promise<string | null> {
    if (this.#running) {
      await this.#bus.send(MSG.CANCEL_JOB, { tabId: this.#tabId });
      return null;
    }

    this.#running = true;
    this.#progress = { status: JobStatus.CONTEXT, message: 'Preparando' };
    this.#emit();

    const response = await this.#bus.send(MSG.START_JOB, {
      tabId: this.#tabId,
      force: Boolean(this.#manifest)
    });

    if (!response?.ok) {
      this.#running = false;
      const error = response?.error ?? 'Falha ao iniciar';
      this.#progress = { status: JobStatus.ERROR, message: error };
      this.#emit();
      return error;
    }
    return null;
  }

  async togglePlayer(): Promise<void> {
    this.#playerEnabled = !this.#playerEnabled;
    this.#emit();
    await this.#bus.send(MSG.SET_ENABLED, { tabId: this.#tabId, enabled: this.#playerEnabled });
  }

  /** Chamado a cada evento de progresso vindo do worker. */
  onProgress(progress: JobProgress, tabId: number): void {
    if (this.#tabId !== null && tabId !== this.#tabId) return;

    this.#progress = progress;
    this.#running = !(!progress.prefetch && isTerminal(progress.status));

    if (progress.status === JobStatus.DONE && !progress.prefetch && progress.key) {
      void this.#adoptFinishedDub(progress.key);
    }
    this.#emit();
  }

  async #adoptFinishedDub(key: string): Promise<void> {
    const response = unwrap(await this.#bus.send(MSG.GET_MANIFEST, { key }));
    if (response?.manifest) this.#manifest = response.manifest;
    this.#emit();
    await this.refreshCache();
  }

  // --------------------------------------------------------------------- cache

  async deleteDub(key: string): Promise<void> {
    await this.#bus.send(MSG.DELETE_DUB, { key });
    if (this.#manifest?.key === key) this.#manifest = null;
    await this.refreshCache();
  }

  async clearCache(): Promise<void> {
    await this.#bus.send(MSG.CLEAR_CACHE, {});
    this.#manifest = null;
    await this.refreshCache();
  }

  // ------------------------------------------------------------------- testes

  async testCredential(engine: TtsEngineId | 'deepgram-stt'): Promise<CredentialTestResult> {
    const response = unwrap(await this.#bus.send(MSG.TEST_CREDENTIAL, { engine }));
    const result = response?.result ?? { ok: false, error: 'sem resposta' };

    // vozes descobertas alimentam o seletor daquele motor
    if (result.ok && result.voices?.length) {
      this.#remoteVoices = { ...this.#remoteVoices, [engine]: result.voices };
      void chrome.storage.local.set({ [VOICE_CACHE_KEY]: this.#remoteVoices });
      this.#emit();
    }

    return result;
  }

  async localServerStatus(engine: LocalTtsEngineId): Promise<LocalServerStatus> {
    const response = unwrap(await this.#bus.send(MSG.LOCAL_STATUS, { engine }));
    return response?.status ?? { ok: false, running: false, port: 0, error: 'sem resposta' };
  }

  async startLocalServer(engine: LocalTtsEngineId): Promise<LocalServerStatus> {
    const response = unwrap(await this.#bus.send(MSG.LOCAL_START, { engine }));
    return response?.status ?? { ok: false, running: false, port: 0, error: 'sem resposta' };
  }

  async stopLocalServer(engine: LocalTtsEngineId): Promise<LocalServerStatus> {
    const response = unwrap(await this.#bus.send(MSG.LOCAL_STOP, { engine }));
    return response?.status ?? { ok: false, running: false, port: 0, error: 'sem resposta' };
  }
}
