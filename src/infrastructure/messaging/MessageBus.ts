/*
 * Barramento de mensagens (Mediator).
 *
 * Os tres contextos da extensao nao se conhecem: falam com o barramento. Ele
 * cuida do que era repetido em cada ponto de envio da versao anterior:
 *
 *   - devolver true do listener para manter o canal aberto em resposta
 *     assincrona, que quando esquecido faz a mensagem sumir sem erro;
 *   - engolir a excecao de aba fechada ou contexto de extensao recarregado,
 *     que e normal e nao merece log;
 *   - embrulhar erro do handler num envelope de falha em vez de deixar a
 *     promessa rejeitar do outro lado da fronteira.
 */

import type { Logger } from '../../application/ports/Logger.ts';
import type { Envelope, MessageContracts, RequestOf, ResponseOf, Result } from './contracts.ts';

export type Handler<K extends keyof MessageContracts> = (
  request: RequestOf<K>,
  sender: chrome.runtime.MessageSender
) => Promise<ResponseOf<K>> | ResponseOf<K>;

/** Handler com os tipos apagados, que e como o mapa consegue guardar todos. */
type ErasedHandler = (
  request: never,
  sender: chrome.runtime.MessageSender
) => Promise<unknown> | unknown;

export class MessageBus {
  readonly #handlers = new Map<string, ErasedHandler>();
  readonly #logger: Logger;
  #listening = false;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  /** Registra o tratamento de uma mensagem (Command). */
  on<K extends keyof MessageContracts>(type: K, handler: Handler<K>): this {
    this.#handlers.set(type as string, handler as ErasedHandler);
    return this;
  }

  /** Passa a atender. Chamado uma vez, no composition root. */
  listen(): void {
    if (this.#listening) return;
    this.#listening = true;

    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      const envelope = message as Envelope | undefined;
      const handler = envelope ? this.#handlers.get(envelope.type) : undefined;
      // sem handler, devolver false deixa outro listener responder
      if (!envelope || !handler) return false;

      Promise.resolve(handler(envelope as never, sender)).then(
        (result) => sendResponse({ ok: true, ...(result as object) }),
        (error: unknown) => {
          this.#logger.error(`handler ${envelope.type} falhou`, error);
          sendResponse({ ok: false, error: describe(error) });
        }
      );

      return true; // resposta assincrona: mantem o canal aberto
    });
  }

  /** Envia para o service worker (ou para o popup, quando ele esta aberto). */
  async send<K extends keyof MessageContracts>(
    type: K,
    request: RequestOf<K>
  ): Promise<Result<ResponseOf<K>> | null> {
    try {
      return (await chrome.runtime.sendMessage({ type, ...request })) as Result<ResponseOf<K>>;
    } catch {
      // contexto da extensao recarregado ou ninguem escutando
      return null;
    }
  }

  /** Envia para o content script de uma aba. */
  async sendToTab<K extends keyof MessageContracts>(
    tabId: number | null | undefined,
    type: K,
    request: RequestOf<K>
  ): Promise<Result<ResponseOf<K>> | null> {
    if (!tabId) return null;
    try {
      return (await chrome.tabs.sendMessage(tabId, { type, ...request })) as Result<ResponseOf<K>>;
    } catch {
      // aba fechada, navegou para fora, ou sem content script: normal
      return null;
    }
  }
}

/** Extrai o payload de uma resposta bem-sucedida, ou null se falhou. */
export function unwrap<T>(result: Result<T> | null): T | null {
  return result && result.ok ? (result as T) : null;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
