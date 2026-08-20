/*
 * Adapter do ElevenLabs.
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
 *
 * Cobra por caractere e a conta pode ficar sem credito no meio de uma aula, por
 * isso o preflight compara o saldo com o tamanho do job antes de comecar.
 */

import type { AudioClip } from '../../domain/entities/AudioClip.ts';
import { ProviderError } from '../../domain/errors/DomainError.ts';
import type {
  PreflightRequest,
  PreflightResult,
  SpeechSynthesisPort,
  SynthesisRequest
} from '../../application/ports/SpeechSynthesisPort.ts';
import type { QuotaInfo, RemoteVoice } from '../../application/ports/CredentialTestPort.ts';
import { HttpClient, bytesToBase64 } from '../http/HttpClient.ts';
import { withRetry } from '../http/retry.ts';

const API = 'https://api.elevenlabs.io/v1';

export interface ElevenLabsConfig {
  readonly apiKey: () => string;
  readonly model: () => string;
  readonly format: () => string;
  readonly concurrency?: number;
}

export class ElevenLabsTtsAdapter implements SpeechSynthesisPort {
  readonly engine = 'elevenlabs' as const;
  readonly concurrency: number;
  readonly #config: ElevenLabsConfig;
  readonly #http = new HttpClient('ElevenLabs');

  constructor(config: ElevenLabsConfig) {
    this.#config = config;
    this.concurrency = config.concurrency ?? 3;
  }

  async speak(request: SynthesisRequest): Promise<AudioClip> {
    return withRetry(
      async () => {
        request.signal.throwIfCanceled();
        return this.#synthesize(request.text, request.voice, this.#config.apiKey());
      },
      { tries: 4, baseDelayMs: 800 }
    );
  }

  async preflight(request: PreflightRequest): Promise<PreflightResult> {
    const apiKey = this.#config.apiKey();
    const quota = await this.getQuota(apiKey);
    const notes: string[] = [];

    if (request.estimatedChars > 0 && quota.limit > 0 && quota.remaining < request.estimatedChars) {
      notes.push(
        `ElevenLabs: restam ${quota.remaining.toLocaleString('pt-BR')} caracteres e esta aula ` +
          `precisa de ~${request.estimatedChars.toLocaleString('pt-BR')}. ` +
          'O que passar do limite vai falhar.'
      );
    }

    // uma sintese minima revela problema de pagamento ou permissao antes do job
    await this.#synthesize('ok', request.voice, apiKey);
    return { notes };
  }

  async listVoices(apiKey: string): Promise<RemoteVoice[]> {
    const response = await this.#http.expectOk(
      await this.#http.send({ url: `${API}/voices`, headers: { 'xi-api-key': apiKey } })
    );
    const data = (await response.json()) as { voices?: { voice_id: string; name: string }[] };
    return (data.voices ?? []).map((voice) => ({ id: voice.voice_id, name: voice.name }));
  }

  async getQuota(apiKey: string): Promise<QuotaInfo> {
    const response = await this.#http.expectOk(
      await this.#http.send({ url: `${API}/user/subscription`, headers: { 'xi-api-key': apiKey } })
    );
    const data = (await response.json()) as {
      tier?: string;
      character_count?: number;
      character_limit?: number;
    };

    const used = Number(data.character_count) || 0;
    const limit = Number(data.character_limit) || 0;
    return { tier: data.tier ?? '', used, limit, remaining: Math.max(0, limit - used) };
  }

  async #synthesize(text: string, voice: string | null, apiKey: string): Promise<AudioClip> {
    const params = new URLSearchParams({ output_format: this.#config.format() });
    const response = await this.#http.send({
      url: `${API}/text-to-speech/${encodeURIComponent(voice ?? '')}?${params.toString()}`,
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: this.#config.model() })
    });

    if (!response.ok) throw await this.#http.readError(response);

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new ProviderError('ElevenLabs', 'ElevenLabs devolveu audio vazio', 502);
    }
    return { parts: [bytesToBase64(buffer)], mime: 'audio/mpeg' };
  }
}
