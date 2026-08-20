/*
 * Adapter de voz do Deepgram (Aura-2).
 * Docs: https://developers.deepgram.com/docs
 *
 * Nao ha voz em portugues no catalogo deles. O EngineResolver ja trata isso e
 * cai para o Google TTS; este adapter existe para quem dubla para en, es, de,
 * fr, nl, it ou ja.
 */

import type { AudioClip } from '../../domain/entities/AudioClip.ts';
import { ProviderError } from '../../domain/errors/DomainError.ts';
import type {
  SpeechSynthesisPort,
  SynthesisRequest
} from '../../application/ports/SpeechSynthesisPort.ts';
import { HttpClient, bytesToBase64 } from '../http/HttpClient.ts';
import { withRetry } from '../http/retry.ts';

const API = 'https://api.deepgram.com/v1';

export class DeepgramTtsAdapter implements SpeechSynthesisPort {
  readonly engine = 'deepgram' as const;
  readonly concurrency: number;
  readonly #apiKey: () => string;
  readonly #http = new HttpClient('Deepgram');

  /**
   * Aura-2 aceita mp3, mas nem todo modelo ou plano. A decisao fica memorizada
   * por sessao para nao repetir a descoberta a cada trecho.
   */
  #mp3Supported = true;

  constructor(apiKey: () => string, concurrency = 4) {
    this.#apiKey = apiKey;
    this.concurrency = concurrency;
  }

  async speak(request: SynthesisRequest): Promise<AudioClip> {
    return withRetry(
      async () => {
        request.signal.throwIfCanceled();

        const params = new URLSearchParams({ model: request.voice ?? 'aura-2-thalia-en' });
        if (this.#mp3Supported) {
          params.set('encoding', 'mp3');
          params.set('bit_rate', '48000');
        }

        const response = await this.#http.send({
          url: `${API}/speak?${params.toString()}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Token ${this.#apiKey()}` },
          body: JSON.stringify({ text: request.text }),
          signal: request.signal
        });

        if (!response.ok) {
          const error = await this.#http.readError(response);
          // alguns modelos rejeitam mp3: desliga e repete em wav
          if (this.#mp3Supported && response.status === 400 && /encoding|bit_rate/i.test(error.body ?? '')) {
            this.#mp3Supported = false;
            throw new ProviderError('Deepgram', 'mp3 indisponivel, repetindo em wav', 429, error.body);
          }
          throw error;
        }

        const mime =
          response.headers.get('content-type') ?? (this.#mp3Supported ? 'audio/mpeg' : 'audio/wav');
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) {
          throw new ProviderError('Deepgram', 'Deepgram devolveu audio vazio', 502);
        }
        return { parts: [bytesToBase64(buffer)], mime };
      },
      { tries: 4, baseDelayMs: 700 }
    );
  }
}
