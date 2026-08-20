/*
 * Adapter do TTS do Google Translate.
 *
 * Usa o endpoint publico que a propria pagina do tradutor consome: sem API key
 * e sem custo, o que faz dele o fallback natural quando falta credencial. Em
 * troca, e nao-oficial: exige throttle, retry e verificacao do content-type,
 * porque a resposta a uma rajada e uma pagina HTML de captcha, nao um erro HTTP.
 *
 * O limite de ~200 caracteres por requisicao e o motivo de AudioClip.parts ser
 * uma lista: um trecho longo vira varios mp3 tocados em sequencia.
 */

import type { AudioClip } from '../../domain/entities/AudioClip.ts';
import { ProviderError } from '../../domain/errors/DomainError.ts';
import { chunkText } from '../../domain/services/TextChunker.ts';
import type {
  SpeechSynthesisPort,
  SynthesisRequest
} from '../../application/ports/SpeechSynthesisPort.ts';
import { HttpClient, bytesToBase64 } from '../http/HttpClient.ts';
import { RateLimiter, withRetry } from '../http/retry.ts';
import { toTtsCode } from '../catalog/languages.catalog.ts';

const TTS_HOSTS = ['https://translate.googleapis.com', 'https://translate.google.com'] as const;
const MAX_CHARS_PER_REQUEST = 180;
const MIN_INTERVAL_MS = 120;

export class GoogleTtsAdapter implements SpeechSynthesisPort {
  readonly engine = 'google' as const;
  readonly concurrency = 2;
  readonly #http = new HttpClient('Google TTS');
  readonly #limiter = new RateLimiter(MIN_INTERVAL_MS);

  async speak(request: SynthesisRequest): Promise<AudioClip> {
    const pieces = chunkText(request.text, MAX_CHARS_PER_REQUEST);
    const parts: string[] = [];

    for (let index = 0; index < pieces.length; index++) {
      parts.push(await this.#speakPiece(pieces[index]!, index, pieces.length, request));
    }

    return { parts, mime: 'audio/mpeg' };
  }

  async #speakPiece(
    piece: string,
    index: number,
    total: number,
    request: SynthesisRequest
  ): Promise<string> {
    return withRetry(
      async (attempt) => {
        request.signal.throwIfCanceled();
        await this.#limiter.acquire();

        // alternar de host entre tentativas contorna bloqueio localizado
        const host = TTS_HOSTS[attempt % TTS_HOSTS.length]!;
        const params = new URLSearchParams({
          ie: 'UTF-8',
          client: 'tw-ob',
          tl: toTtsCode(request.targetLang),
          ttsspeed: '1',
          total: String(total),
          idx: String(index),
          textlen: String(piece.length),
          q: piece
        });

        const response = await this.#http.send({
          url: `${host}/translate_tts?${params.toString()}`,
          signal: request.signal
        });
        if (!response.ok) throw await this.#http.readError(response);

        // resposta HTML significa bloqueio: tratamos como 429 para o retry pegar
        const mime = response.headers.get('content-type') ?? '';
        if (!/audio/i.test(mime)) {
          throw new ProviderError(
            'Google TTS',
            `Google TTS devolveu ${mime || 'conteudo desconhecido'}`,
            429
          );
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) {
          throw new ProviderError('Google TTS', 'Google TTS devolveu audio vazio', 502);
        }
        return bytesToBase64(buffer);
      },
      { tries: 5, baseDelayMs: 900 }
    );
  }
}
