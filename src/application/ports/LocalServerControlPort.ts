/**
 * Porta de controle dos servidores de TTS local.
 *
 * Uma extensao nao pode iniciar processos, entao ligar e desligar o Piper, o
 * Kokoro ou o F5 passa por um native messaging host. Quando o host nao esta
 * registrado nada quebra: o popup so avisa que o controle nao esta instalado e
 * o usuario sobe o servidor pelo script.
 */

import type { LocalTtsEngineId } from '../../domain/value-objects/EngineId.ts';

export interface LocalServerStatus {
  readonly ok: boolean;
  readonly running: boolean;
  readonly port: number;
  readonly pid?: number | null;
  /** Dispositivo em que o modelo carregou (cpu ou cuda), quando informado. */
  readonly device?: string | null;
  /** O host de native messaging nao esta registrado neste navegador. */
  readonly missing?: boolean;
  readonly error?: string;
}

export interface LocalServerCommand {
  readonly engine: LocalTtsEngineId;
  readonly port: number;
  readonly voice?: string;
  readonly cuda?: boolean;
}

export interface LocalServerControlPort {
  status(command: LocalServerCommand): Promise<LocalServerStatus>;
  start(command: LocalServerCommand): Promise<LocalServerStatus>;
  stop(command: LocalServerCommand): Promise<LocalServerStatus>;
}
