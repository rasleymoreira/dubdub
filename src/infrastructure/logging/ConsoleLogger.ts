/** Logger de console com prefixo, para filtrar no DevTools por [udub]. */

import type { Logger } from '../../application/ports/Logger.ts';

export class ConsoleLogger implements Logger {
  readonly #prefix: string;

  constructor(scope: string) {
    this.#prefix = `[udub:${scope}]`;
  }

  debug(message: string, ...details: unknown[]): void {
    console.debug(this.#prefix, message, ...details);
  }

  info(message: string, ...details: unknown[]): void {
    console.info(this.#prefix, message, ...details);
  }

  warn(message: string, ...details: unknown[]): void {
    console.warn(this.#prefix, message, ...details);
  }

  error(message: string, ...details: unknown[]): void {
    console.error(this.#prefix, message, ...details);
  }
}

/** Descarta tudo. Usado em teste para nao poluir a saida. */
export const SILENT_LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
