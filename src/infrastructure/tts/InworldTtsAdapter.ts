/*
 * Adapter do Inworld TTS.
 * Docs: https://docs.inworld.ai
 *
 * POST /tts/v1/voice devolve JSON com o audio ja em base64, que e exatamente o
 * formato que o player consome: e o unico provedor que dispensa a conversao.
 */

import type { AudioClip } from '../../domain/entities/AudioClip.ts';
import { ProviderError } from '../../domain/errors/DomainError.ts';
import { baseLanguage } from '../../domain/value-objects/LanguageCode.ts';
import type {
  PreflightRequest,
  PreflightResult,
  SpeechSynthesisPort,
  SynthesisRequest
} from '../../application/ports/SpeechSynthesisPort.ts';
import type { RemoteVoice } from '../../application/ports/CredentialTestPort.ts';
import { HttpClient } from '../http/HttpClient.ts';
import { withRetry } from '../http/retry.ts';

const API = 'https://api.inworld.ai/tts/v1';

export interface InworldConfig {
  readonly apiKey: () => string;
  readonly model: () => string;
  readonly bitRate: () => number;
  readonly concurrency?: number;
}

/** A credencial ja vem em base64 (chave:segredo); aceitamos com ou sem prefixo. */
function authHeaders(apiKey: string): Record<string, string> {
  const value = String(apiKey ?? '')
    .trim()
    .replace(/^Basic\s+/i, '');
  return { Authorization: `Basic ${value}`, 'Content-Type': 'application/json' };
}

export class InworldTtsAdapter implements SpeechSynthesisPort {
  readonly engine = 'inworld' as const;
  readonly concurrency: number;
  readonly #config: InworldConfig;
  readonly #http = new HttpClient('Inworld');

  constructor(config: InworldConfig) {
    this.#config = config;
    this.concurrency = config.concurrency ?? 3;
  }

  async speak(request: SynthesisRequest): Promise<AudioClip> {
    return withRetry(
      async () => {
        request.signal.throwIfCanceled();

        const audioConfig: Record<string, unknown> = { audioEncoding: 'MP3' };
        const bitRate = this.#config.bitRate();
        if (bitRate) audioConfig['bitRate'] = Number(bitRate);

        const response = await this.#http.send({
          url: `${API}/voice`,
          method: 'POST',
          headers: authHeaders(this.#config.apiKey()),
          body: JSON.stringify({
            text: request.text,
            voiceId: request.voice ?? 'Heitor',
            modelId: this.#config.model(),
            audioConfig
          }),
          signal: request.signal
        });

        if (!response.ok) throw await this.#http.readError(response);

        const data = (await response.json()) as {
          audioContent?: string;
          audio_content?: string;
        };
        const audio = data.audioContent ?? data.audio_content;
        if (!audio) throw new ProviderError('Inworld', 'Inworld nao devolveu audio', 502);

        return { parts: [audio], mime: 'audio/mpeg' };
      },
      { tries: 4, baseDelayMs: 700 }
    );
  }

  /** Confirma a credencial e avisa se a voz escolhida nao fala o idioma. */
  async preflight(request: PreflightRequest): Promise<PreflightResult> {
    const language = baseLanguage(request.targetLang);
    const voices = await this.listVoices(this.#config.apiKey(), language);
    const notes: string[] = [];

    if (voices.length > 0 && !voices.some((voice) => voice.id === request.voice)) {
      const nomes = voices
        .slice(0, 6)
        .map((voice) => voice.id)
        .join(', ');
      notes.push(
        `Voz "${request.voice}" nao aparece nas vozes de ${language}. Disponiveis: ${nomes}`
      );
    }

    return { notes };
  }

  async listVoices(apiKey: string, language?: string): Promise<RemoteVoice[]> {
    const query = language ? `?filter=language=${encodeURIComponent(language)}` : '';
    const response = await this.#http.expectOk(
      await this.#http.send({ url: `${API}/voices${query}`, headers: authHeaders(apiKey) })
    );

    const data = (await response.json()) as {
      voices?: { voiceId: string; displayName?: string; description?: string }[];
    };

    return (data.voices ?? []).map((voice) => ({
      id: voice.voiceId,
      name: voice.displayName ?? voice.voiceId,
      description: voice.description ?? ''
    }));
  }
}
