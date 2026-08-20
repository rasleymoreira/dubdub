/*
 * Adapter dos servidores de TTS local: Piper, Kokoro e F5-TTS.
 *
 * Um adapter so para os tres (Template Method). O fluxo e identico: descobrir o
 * protocolo, sintetizar, ler o audio, e no preflight confirmar que o servidor
 * responde antes de comecar um job longo. O que varia entre eles e apenas
 * configuracao: URL, rotulo e como montar a dica de erro.
 *
 * A versao anterior tinha um cliente compartilhado, mas as diferencas ficavam
 * espalhadas: LOCAL_ENGINES no pipeline, LOCAL_TTS no service worker e
 * LOCAL_PANELS no popup, cada um com a sua copia dos mesmos tres campos.
 */

import type { AudioClip } from '../../domain/entities/AudioClip.ts';
import type { LocalTtsEngineId, VoiceId } from '../../domain/value-objects/EngineId.ts';
import { LocalServerUnavailableError, ProviderError } from '../../domain/errors/DomainError.ts';
import type {
  PreflightRequest,
  PreflightResult,
  SpeechSynthesisPort,
  SynthesisRequest
} from '../../application/ports/SpeechSynthesisPort.ts';
import { HttpClient, bytesToBase64 } from '../http/HttpClient.ts';
import { withRetry } from '../http/retry.ts';
import {
  LOCAL_TTS_PROTOCOLS,
  OPENAI_PROTOCOL,
  WRONG_PROTOCOL_STATUSES,
  looksLikeOpenAi,
  type LocalTtsProtocol
} from './protocols/LocalTtsProtocol.ts';

export interface LocalTtsConfig {
  readonly engine: LocalTtsEngineId;
  readonly label: string;
  readonly concurrency: number;
  /** Lido a cada chamada: o usuario pode trocar a porta sem recarregar nada. */
  readonly baseUrl: () => string;
  readonly lengthScale?: () => number;
  /** Como subir este servidor, para a mensagem de erro ser acionavel. */
  readonly setupHint: string;
}

export interface LocalServerInfo {
  readonly device?: string;
  readonly [key: string]: unknown;
}

/** Formato que funcionou, por URL. Evita redescobrir a cada trecho. */
const protocolMemo = new Map<string, LocalTtsProtocol>();

function normalizeBase(url: string): string {
  return String(url ?? '')
    .trim()
    .replace(/\/+$/, '');
}

export class LocalHttpTtsAdapter implements SpeechSynthesisPort {
  readonly engine: LocalTtsEngineId;
  readonly concurrency: number;
  readonly #config: LocalTtsConfig;
  readonly #http: HttpClient;

  constructor(config: LocalTtsConfig) {
    this.engine = config.engine;
    this.concurrency = config.concurrency;
    this.#config = config;
    this.#http = new HttpClient(config.label);
  }

  async speak(request: SynthesisRequest): Promise<AudioClip> {
    const base = normalizeBase(this.#config.baseUrl());

    return withRetry(
      async () => {
        request.signal.throwIfCanceled();
        return this.#trySynthesize(base, request.text, request.voice);
      },
      { tries: 3, baseDelayMs: 500 }
    );
  }

  /**
   * Falha cedo: um servidor desligado deve ser detectado antes de o usuario
   * esperar por uma aula inteira que nunca vai sair.
   */
  async preflight(request: PreflightRequest): Promise<PreflightResult> {
    const base = normalizeBase(this.#config.baseUrl());
    const notes: string[] = [];

    try {
      const info = await this.info(base);
      // o servidor do Kokoro avisa quando caiu para CPU apesar da GPU pedida
      if (info?.device) notes.push(`${this.#config.label} rodando em ${info.device}.`);
      await this.#trySynthesize(base, 'ok', request.voice);
    } catch (error) {
      throw new LocalServerUnavailableError(
        this.#config.label,
        base,
        this.#config.setupHint,
        error instanceof Error ? error.message : String(error)
      );
    }

    return { notes };
  }

  /** Vozes que o servidor expoe. Nem todo servidor tem /voices. */
  async listVoices(baseUrl?: string): Promise<VoiceId[] | null> {
    const base = normalizeBase(baseUrl ?? this.#config.baseUrl());
    try {
      const response = await this.#http.send({ url: `${base}/voices` });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      return parseVoiceList(data);
    } catch {
      return null;
    }
  }

  /** Dados do servidor, quando ele expoe /info (dispositivo, modelo, idioma). */
  async info(baseUrl?: string): Promise<LocalServerInfo | null> {
    const base = normalizeBase(baseUrl ?? this.#config.baseUrl());
    try {
      const response = await this.#http.send({ url: `${base}/info` });
      return response.ok ? ((await response.json()) as LocalServerInfo) : null;
    } catch {
      return null;
    }
  }

  /** Qual protocolo tentar: o memorizado, o da OpenAI, ou todos em ordem. */
  #protocolsFor(base: string): readonly LocalTtsProtocol[] {
    if (looksLikeOpenAi(base)) return [OPENAI_PROTOCOL];
    const known = protocolMemo.get(base);
    return known ? [known] : LOCAL_TTS_PROTOCOLS;
  }

  async #trySynthesize(base: string, text: string, voice: VoiceId | null): Promise<AudioClip> {
    let lastError: ProviderError | null = null;

    for (const protocol of this.#protocolsFor(base)) {
      const built = protocol.buildRequest({
        baseUrl: base,
        text,
        voice,
        lengthScale: this.#config.lengthScale?.()
      });

      const response = await this.#http.send({
        url: built.url,
        method: built.init.method as 'GET' | 'POST',
        ...(built.init.headers ? { headers: built.init.headers as Record<string, string> } : {}),
        ...(typeof built.init.body === 'string' ? { body: built.init.body } : {})
      });

      if (response.ok) {
        protocolMemo.set(base, protocol);
        return readAudio(response, this.#config.label);
      }

      lastError = await this.#http.readError(response);
      // status de formato errado: vale tentar o proximo protocolo
      if (!WRONG_PROTOCOL_STATUSES.includes(response.status)) throw lastError;
    }

    // nenhum formato serviu: esquece o memorizado para redescobrir na proxima
    protocolMemo.delete(base);
    throw (
      lastError ??
      new ProviderError(this.#config.label, `${this.#config.label} nao respondeu em nenhum formato conhecido`)
    );
  }
}

async function readAudio(response: Response, provider: string): Promise<AudioClip> {
  const contentType = response.headers.get('content-type') ?? '';
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new ProviderError(provider, `${provider} devolveu audio vazio`, 502);
  }
  const mime = /audio|wav|mpeg/i.test(contentType) ? contentType.split(';')[0]! : 'audio/wav';
  return { parts: [bytesToBase64(buffer)], mime };
}

/** O formato de /voices variou entre versoes: aceitamos os tres que existem. */
function parseVoiceList(data: unknown): VoiceId[] {
  const nameOf = (item: unknown): string => {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      const key = record['key'] ?? record['name'];
      if (typeof key === 'string') return key;
    }
    return String(item);
  };

  if (Array.isArray(data)) return data.map(nameOf);
  if (typeof data === 'object' && data !== null) {
    const voices = (data as Record<string, unknown>)['voices'];
    if (Array.isArray(voices)) return voices.map(nameOf);
    return Object.keys(data);
  }
  return [];
}
