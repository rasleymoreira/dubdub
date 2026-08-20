/*
 * Contrato das mensagens entre os tres contextos da extensao.
 *
 * Antes eram strings soltas num objeto MSG e payloads sem tipo nenhum: quem
 * enviava e quem recebia precisavam concordar de cabeca sobre os campos, e um
 * erro de digitacao em `message.lectureId` virava undefined silencioso.
 *
 * Aqui cada mensagem declara request e response. O TypeScript passa a recusar
 * um send com payload errado e um handler que devolve a forma errada.
 *
 * Consolidacao: os quatro testes de credencial que existiam (VALIDATE_KEY,
 * ELEVEN_TEST, INWORLD_TEST, LOCAL_TEST) viraram um TEST_CREDENTIAL com o
 * motor como discriminador, porque a diferenca entre eles ja esta no catalogo.
 */

import type { DubManifest, DubSummary } from '../../application/dto/DubManifest.ts';
import type { JobProgress } from '../../application/dto/JobProgress.ts';
import type { Settings, SettingsPatch } from '../../application/dto/Settings.ts';
import type { CredentialTestResult } from '../../application/ports/CredentialTestPort.ts';
import type {
  LocalServerStatus,
  LocalServerCommand
} from '../../application/ports/LocalServerControlPort.ts';
import type { StoredClip, StorageEstimate } from '../../application/ports/repositories.ts';
import type { CurriculumItem, Lecture } from '../../domain/entities/Lecture.ts';
import type { EngineSelection } from '../../domain/services/EngineResolver.ts';
import type { TtsEngineId } from '../../domain/value-objects/EngineId.ts';

export const MSG = {
  // popup -> service worker
  GET_STATE: 'GET_STATE',
  START_JOB: 'START_JOB',
  CANCEL_JOB: 'CANCEL_JOB',
  SET_SETTINGS: 'SET_SETTINGS',
  SET_ENABLED: 'SET_ENABLED',
  LIST_DUBS: 'LIST_DUBS',
  DELETE_DUB: 'DELETE_DUB',
  CLEAR_CACHE: 'CLEAR_CACHE',
  TEST_CREDENTIAL: 'TEST_CREDENTIAL',
  LOCAL_STATUS: 'LOCAL_STATUS',
  LOCAL_START: 'LOCAL_START',
  LOCAL_STOP: 'LOCAL_STOP',

  // content script -> service worker
  CONTENT_READY: 'CONTENT_READY',
  GET_MANIFEST: 'GET_MANIFEST',
  GET_CLIPS: 'GET_CLIPS',
  PING: 'PING',

  // service worker -> content script
  GET_LECTURE_CONTEXT: 'GET_LECTURE_CONTEXT',
  GET_CURRICULUM: 'GET_CURRICULUM',
  GET_TAB_STATE: 'GET_TAB_STATE',
  FETCH_TEXT: 'FETCH_TEXT',
  JOB_PROGRESS: 'JOB_PROGRESS',
  DUB_READY: 'DUB_READY',
  APPLY_SETTINGS: 'APPLY_SETTINGS',
  APPLY_ENABLED: 'APPLY_ENABLED'
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

/** Envelope comum: toda resposta diz se deu certo. */
export interface Ok {
  readonly ok: true;
}

export interface Failed {
  readonly ok: false;
  readonly error: string;
}

export type Result<T> = (Ok & T) | Failed;

export interface PopupState {
  readonly settings: Settings;
  readonly engines: EngineSelection;
  readonly lecture: Lecture | null;
  readonly manifest: DubManifest | null;
  /** A dublagem esta aplicada no player agora. */
  readonly enabled: boolean;
  readonly running: boolean;
  readonly progress: JobProgress | null;
}

export interface TabState {
  readonly lecture: Lecture | null;
  readonly enabled: boolean;
  readonly hasDub: boolean;
  readonly running: boolean;
  readonly progress: JobProgress | null;
}

/**
 * Mapa dos contratos. `request` e o que vai junto do type; `response` e o que
 * o handler devolve dentro do envelope de sucesso.
 */
export interface MessageContracts {
  [MSG.GET_STATE]: { request: { tabId: number | null }; response: PopupState };
  [MSG.START_JOB]: {
    request: { tabId: number | null; startAt?: number | undefined; force?: boolean | undefined };
    response: Record<string, never>;
  };
  [MSG.CANCEL_JOB]: { request: { tabId: number | null }; response: { canceled: boolean } };
  [MSG.SET_SETTINGS]: {
    request: { patch: SettingsPatch };
    response: { settings: Settings; engines: EngineSelection };
  };
  [MSG.SET_ENABLED]: {
    request: { tabId: number | null; enabled: boolean };
    response: Record<string, never>;
  };
  [MSG.LIST_DUBS]: {
    request: Record<string, never>;
    response: { dubs: readonly DubSummary[]; usage: StorageEstimate | null };
  };
  [MSG.DELETE_DUB]: { request: { key: string }; response: Record<string, never> };
  [MSG.CLEAR_CACHE]: { request: Record<string, never>; response: Record<string, never> };
  [MSG.TEST_CREDENTIAL]: {
    request: {
      engine: TtsEngineId | 'deepgram-stt';
      apiKey?: string | undefined;
      url?: string | undefined;
      voice?: string | undefined;
    };
    response: { result: CredentialTestResult };
  };
  [MSG.LOCAL_STATUS]: {
    request: { engine: LocalServerCommand['engine'] };
    response: { status: LocalServerStatus };
  };
  [MSG.LOCAL_START]: {
    request: { engine: LocalServerCommand['engine'] };
    response: { status: LocalServerStatus };
  };
  [MSG.LOCAL_STOP]: {
    request: { engine: LocalServerCommand['engine'] };
    response: { status: LocalServerStatus };
  };

  [MSG.CONTENT_READY]: {
    request: { lecture: Lecture };
    response: { settings: Settings; manifest: DubManifest | null; progress: JobProgress | null };
  };
  [MSG.GET_MANIFEST]: {
    request: { key?: string | undefined; lectureId?: string | undefined };
    response: { manifest: DubManifest | null; settings: Settings };
  };
  [MSG.GET_CLIPS]: {
    request: { key: string; from: number; count: number };
    response: { clips: readonly StoredClip[] };
  };
  [MSG.PING]: { request: { tabId: number | null }; response: { running: boolean } };

  [MSG.GET_LECTURE_CONTEXT]: {
    request: { lectureId?: string | undefined };
    response: { lecture: Lecture | null };
  };
  [MSG.GET_CURRICULUM]: {
    request: Record<string, never>;
    response: { items: readonly CurriculumItem[] };
  };
  [MSG.GET_TAB_STATE]: { request: Record<string, never>; response: TabState };
  [MSG.FETCH_TEXT]: { request: { url: string }; response: { text: string } };
  [MSG.JOB_PROGRESS]: {
    request: { tabId: number; progress: JobProgress };
    response: Record<string, never>;
  };
  [MSG.DUB_READY]: {
    request: { manifest: DubManifest; lectureId: string; autoEnable: boolean };
    response: Record<string, never>;
  };
  [MSG.APPLY_SETTINGS]: { request: { settings: Settings }; response: Record<string, never> };
  [MSG.APPLY_ENABLED]: { request: { enabled: boolean }; response: Record<string, never> };
}

export type RequestOf<K extends keyof MessageContracts> = MessageContracts[K]['request'];
export type ResponseOf<K extends keyof MessageContracts> = MessageContracts[K]['response'];

/** O que trafega no fio: o tipo mais o payload. */
export type Envelope<K extends keyof MessageContracts = keyof MessageContracts> = {
  readonly type: K;
} & RequestOf<K>;
