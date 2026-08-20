/*
 * Controle dos servidores de TTS local via native messaging.
 *
 * Uma extensao nao pode iniciar processos. Quem sobe e derruba o Piper, o
 * Kokoro e o F5 e um host registrado por tools/install-native-host.ps1.
 *
 * Quando o host nao esta instalado, nada quebra: distinguimos essa condicao das
 * demais falhas para o popup poder dizer o que fazer em vez de mostrar um erro
 * generico. Sem o host, o usuario sobe os servidores pelos scripts.
 */

import type {
  LocalServerCommand,
  LocalServerControlPort,
  LocalServerStatus
} from '../../application/ports/LocalServerControlPort.ts';
import { LOCAL_SERVER_CATALOG } from '../catalog/engines.catalog.ts';

const NATIVE_HOST = 'com.udub.piper';

interface NativeResponse {
  ok?: boolean;
  running?: boolean;
  port?: number;
  pid?: number | null;
  error?: string;
}

/** A mensagem de erro do Chrome e a unica pista de que o host nao existe. */
function looksMissing(message: string): boolean {
  return /not found|Access to the specified native messaging host/i.test(message);
}

export class NativeHostAdapter implements LocalServerControlPort {
  status(command: LocalServerCommand): Promise<LocalServerStatus> {
    return this.#send('status', command);
  }

  start(command: LocalServerCommand): Promise<LocalServerStatus> {
    return this.#send('start', command);
  }

  stop(command: LocalServerCommand): Promise<LocalServerStatus> {
    return this.#send('stop', command);
  }

  #send(action: string, command: LocalServerCommand): Promise<LocalServerStatus> {
    const descriptor = LOCAL_SERVER_CATALOG[command.engine];
    const port = command.port || descriptor.defaultPort;

    const payload = {
      action,
      engine: command.engine,
      port,
      voice: command.voice ?? descriptor.defaultVoice,
      cuda: Boolean(command.cuda)
    };

    return new Promise((resolve) => {
      try {
        chrome.runtime.sendNativeMessage(NATIVE_HOST, payload, (response: NativeResponse) => {
          const failure = chrome.runtime.lastError;
          if (failure) {
            const message = failure.message ?? 'host indisponivel';
            resolve({
              ok: false,
              running: false,
              port,
              missing: looksMissing(message),
              error: message
            });
            return;
          }

          resolve({
            ok: response?.ok ?? false,
            running: Boolean(response?.running),
            port: response?.port ?? port,
            pid: response?.pid ?? null,
            ...(response?.error ? { error: response.error } : {})
          });
        });
      } catch (error) {
        resolve({
          ok: false,
          running: false,
          port,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }
}
