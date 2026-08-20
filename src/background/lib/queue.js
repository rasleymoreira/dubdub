/* Concorrencia limitada, retry com backoff e utilitarios de tempo. */

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CanceledError extends Error {
  constructor() {
    super('canceled');
    this.name = 'CanceledError';
  }
}

/** Token de cancelamento simples compartilhado pelas etapas do job. */
export class CancelToken {
  constructor() {
    this.canceled = false;
  }
  cancel() {
    this.canceled = true;
  }
  check() {
    if (this.canceled) throw new CanceledError();
  }
}

/**
 * Executa `worker` sobre `items` com no maximo `limit` chamadas simultaneas.
 * Preserva a ordem dos resultados e propaga o primeiro erro fatal.
 */
export async function mapLimit(items, limit, worker, token) {
  const results = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      if (token) token.check();
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: size }, run));
  return results;
}

/**
 * Retry com backoff exponencial e jitter. `shouldRetry` decide pelo erro;
 * erros de cancelamento nunca sao repetidos.
 */
export async function withRetry(fn, options = {}) {
  const tries = options.tries || 3;
  const baseDelay = options.baseDelay || 600;
  const shouldRetry = options.shouldRetry || (() => true);
  let lastError;

  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (error instanceof CanceledError) throw error;
      lastError = error;
      if (attempt === tries - 1 || !shouldRetry(error)) break;
      const jitter = Math.floor(Math.random() * 250);
      await sleep(baseDelay * Math.pow(2, attempt) + jitter);
    }
  }
  throw lastError;
}

/** Erro HTTP com status, para decidir retry (429/5xx) sem inspecionar texto. */
export class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export function isRetriableHttp(error) {
  if (!(error instanceof HttpError)) return true; // falha de rede
  return error.status === 429 || error.status === 408 || error.status >= 500;
}

export function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
