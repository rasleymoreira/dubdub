/*
 * Retry com backoff exponencial e jitter.
 *
 * Antes cada um dos cinco clientes HTTP tinha a sua copia deste laco. Agora e
 * um decorador aplicado sobre a operacao: quem chama descreve o que fazer e a
 * politica decide quando insistir.
 *
 * O jitter existe porque uma aula dispara centenas de sinteses em paralelo; sem
 * ele, um 429 sincronizaria todas as tentativas seguintes no mesmo instante e o
 * provedor tomaria uma rajada em vez de um fluxo.
 */

import { CanceledError, ProviderError } from '../../domain/errors/DomainError.ts';

export interface RetryOptions {
  readonly tries?: number;
  readonly baseDelayMs?: number;
  readonly jitterMs?: number;
  readonly shouldRetry?: (error: unknown) => boolean;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Falha de rede (erro sem status) tambem vale repetir. */
export function isRetriable(error: unknown): boolean {
  if (error instanceof CanceledError) return false;
  if (error instanceof ProviderError) return error.retriable;
  return true;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const tries = options.tries ?? 3;
  const baseDelay = options.baseDelayMs ?? 600;
  const jitter = options.jitterMs ?? 250;
  const shouldRetry = options.shouldRetry ?? isRetriable;

  let lastError: unknown;

  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      // cancelamento nunca e repetido: o usuario pediu para parar
      if (error instanceof CanceledError) throw error;
      lastError = error;
      if (attempt === tries - 1 || !shouldRetry(error)) break;
      await sleep(baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * jitter));
    }
  }

  throw lastError;
}

/**
 * Serializa o inicio das requisicoes, respeitando um intervalo minimo.
 *
 * Necessario para os endpoints publicos do Google, que nao tem API key e
 * respondem 429 (ou uma pagina de captcha) quando recebem rajadas.
 */
export class RateLimiter {
  readonly #minIntervalMs: number;
  #gate: Promise<void> = Promise.resolve();

  constructor(minIntervalMs: number) {
    this.#minIntervalMs = minIntervalMs;
  }

  acquire(): Promise<void> {
    const next = this.#gate.then(() => sleep(this.#minIntervalMs));
    this.#gate = next;
    return next;
  }
}
