/*
 * Cliente HTTP dos adapters.
 *
 * Fino de proposito: existe para dar um ponto unico de leitura de erro e de
 * conversao de corpo binario, nao para reimplementar fetch. O que era repetido
 * nos cinco clientes antigos era exatamente isso: cada um tinha o seu readError
 * quase identico e a sua conversao de ArrayBuffer para base64.
 */

import { ProviderError } from '../../domain/errors/DomainError.ts';
import type { CancellationSignal } from '../../application/services/CancellationToken.ts';

export interface HttpRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: CancellationSignal;
  /** Envia os cookies da origem. So faz sentido dentro do content script. */
  readonly credentials?: RequestCredentials;
}

export class HttpClient {
  readonly #provider: string;

  constructor(provider: string) {
    this.#provider = provider;
  }

  async send(request: HttpRequest): Promise<Response> {
    request.signal?.throwIfCanceled();

    const init: RequestInit = {
      method: request.method ?? 'GET',
      credentials: request.credentials ?? 'omit'
    };
    if (request.headers) init.headers = { ...request.headers };
    if (request.body !== undefined) init.body = request.body;

    try {
      return await fetch(request.url, init);
    } catch (error) {
      // sem status: falha de rede, servidor fora do ar, CORS
      throw new ProviderError(
        this.#provider,
        `${this.#provider}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Le o corpo de erro e extrai a mensagem mais util que encontrar.
   *
   * Cada provedor coloca o texto em um campo diferente (err_msg, reason,
   * detail, message), entao tentamos todos antes de cair no corpo cru.
   */
  async readError(response: Response): Promise<ProviderError> {
    const body = await response.text().catch(() => '');
    let message = body.slice(0, 300);

    try {
      const parsed: unknown = JSON.parse(body);
      const extracted = extractMessage(parsed);
      if (extracted) message = extracted;
    } catch {
      /* corpo nao e JSON: fica o texto cru */
    }

    return new ProviderError(
      this.#provider,
      `${this.#provider} ${response.status}: ${message}`,
      response.status,
      body
    );
  }

  /** Garante uma resposta ok, lancando ProviderError com detalhe legivel. */
  async expectOk(response: Response): Promise<Response> {
    if (!response.ok) throw await this.readError(response);
    return response;
  }
}

function extractMessage(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  for (const field of ['err_msg', 'reason', 'message', 'error']) {
    const value = record[field];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'object' && value !== null) {
      const nested = (value as Record<string, unknown>)['message'];
      if (typeof nested === 'string' && nested) return nested;
    }
  }

  // o ElevenLabs usa detail, que pode ser string ou objeto
  const detail = record['detail'];
  if (typeof detail === 'string' && detail) return detail;
  if (typeof detail === 'object' && detail !== null) {
    const nested = (detail as Record<string, unknown>)['message'];
    if (typeof nested === 'string' && nested) return nested;
  }

  return null;
}

/**
 * Converte binario para base64.
 *
 * Em blocos porque String.fromCharCode com centenas de milhares de argumentos
 * estoura a pilha de chamadas, e um WAV de trinta segundos passa disso.
 */
export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}
