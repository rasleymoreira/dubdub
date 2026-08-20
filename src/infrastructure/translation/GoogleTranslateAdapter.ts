/*
 * Adapter de traducao do Google Translate.
 *
 * Endpoint publico, sem API key. Traduz varias linhas por requisicao para
 * reduzir chamadas: o Google devolve os fragmentos em ordem e preserva as
 * quebras de linha, entao remontamos e conferimos a contagem.
 *
 * Se a contagem nao bater, uma linha se fundiu com outra e as traducoes sairiam
 * desalinhadas dos tempos do video, o que estraga a dublagem inteira de forma
 * silenciosa. Nesse caso o lote e refeito linha a linha.
 */

import { ProviderError } from '../../domain/errors/DomainError.ts';
import { isAutoDetect } from '../../domain/value-objects/LanguageCode.ts';
import type {
  TranslationPort,
  TranslationRequest
} from '../../application/ports/TranslationPort.ts';
import { HttpClient } from '../http/HttpClient.ts';
import { withRetry } from '../http/retry.ts';
import { toTranslateCode } from '../catalog/languages.catalog.ts';

const HOST = 'https://translate.googleapis.com';
const MAX_CHARS_PER_BATCH = 1200;
const MAX_LINES_PER_BATCH = 20;

interface BatchItem {
  readonly index: number;
  readonly value: string;
}

export class GoogleTranslateAdapter implements TranslationPort {
  readonly #http = new HttpClient('Google Translate');

  async translate(request: TranslationRequest): Promise<string[]> {
    const output = new Array<string>(request.texts.length).fill('');
    const batches = splitIntoBatches(request.texts);
    let done = 0;

    for (const batch of batches) {
      request.signal.throwIfCanceled();
      const lines = batch.map((item) => item.value);

      let translated = await this.#translateJoined(lines, request).catch((error: unknown) => {
        if (error instanceof ProviderError) return null;
        throw error;
      });

      // o lote desalinhou: refaz linha a linha para nao trocar as falas de lugar
      if (!translated) {
        translated = [];
        for (const line of lines) {
          const single = await this.#translateJoined([line], request);
          translated.push(single?.[0] ?? line);
        }
      }

      batch.forEach((item, position) => {
        output[item.index] = translated[position] || item.value;
      });

      done += batch.length;
      request.onProgress?.(done, request.texts.length);
    }

    return output;
  }

  async #translateJoined(
    lines: readonly string[],
    request: TranslationRequest
  ): Promise<string[] | null> {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: isAutoDetect(request.from) ? 'auto' : toTranslateCode(request.from),
      tl: toTranslateCode(request.to),
      dt: 't',
      q: lines.join('\n')
    });

    const data = await withRetry(
      async () => {
        request.signal.throwIfCanceled();
        const response = await this.#http.send({
          url: `${HOST}/translate_a/single?${params.toString()}`,
          signal: request.signal
        });
        const text = await response.text();

        if (!response.ok) {
          throw new ProviderError(
            'Google Translate',
            `Google Translate ${response.status}`,
            response.status,
            text
          );
        }
        if (looksLikeBlockPage(text)) {
          throw new ProviderError(
            'Google Translate',
            'Google Translate bloqueou a requisicao',
            429
          );
        }

        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new ProviderError(
            'Google Translate',
            'Resposta inesperada do Google Translate',
            502,
            text.slice(0, 200)
          );
        }
      },
      { tries: 4, baseDelayMs: 800 }
    );

    return reassemble(data, lines);
  }
}

/** Uma pagina HTML no lugar do JSON significa bloqueio por trafego suspeito. */
function looksLikeBlockPage(text: string): boolean {
  return /unusual traffic|captcha|<html/i.test(text.slice(0, 400));
}

function splitIntoBatches(texts: readonly string[]): BatchItem[][] {
  const batches: BatchItem[][] = [];
  let current: BatchItem[] = [];
  let chars = 0;

  texts.forEach((text, index) => {
    const value = String(text ?? '')
      .replace(/\s*\n\s*/g, ' ')
      .trim();

    if (current.length >= MAX_LINES_PER_BATCH || chars + value.length > MAX_CHARS_PER_BATCH) {
      if (current.length > 0) batches.push(current);
      current = [];
      chars = 0;
    }

    current.push({ index, value });
    chars += value.length + 1;
  });

  if (current.length > 0) batches.push(current);
  return batches;
}

/** Devolve null quando a contagem de linhas nao bate com o pedido. */
function reassemble(data: unknown, lines: readonly string[]): string[] | null {
  const fragments = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[]) : [];
  const joined = fragments
    .map((fragment) => (Array.isArray(fragment) ? String(fragment[0] ?? '') : ''))
    .join('');

  const result = joined.split('\n');
  // o Google as vezes engole linhas vazias no fim
  while (result.length < lines.length) result.push('');
  if (result.length !== lines.length) return null;

  return result.map((value, index) => value.trim() || lines[index]!);
}
