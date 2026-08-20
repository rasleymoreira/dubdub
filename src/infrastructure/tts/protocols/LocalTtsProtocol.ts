/*
 * Protocolos aceitos pelos servidores de TTS local (Strategy).
 *
 * Os tres servidores expoem o mesmo contrato logico, mas o piper.http_server
 * variou de formato entre versoes e servidores compativeis com a API da OpenAI
 * usam outro corpo. Antes isso era um if/if/if dentro de callMode; agora cada
 * formato e uma estrategia, e descobrir qual funciona e so percorrer a lista.
 *
 * O formato que der certo fica memorizado por URL, entao o custo da descoberta
 * e pago uma vez por servidor e nao a cada trecho de uma aula inteira.
 */

export interface ProtocolRequest {
  readonly baseUrl: string;
  readonly text: string;
  readonly voice: string | null;
  readonly lengthScale?: number | undefined;
  readonly speed?: number | undefined;
}

export interface LocalTtsProtocol {
  readonly id: string;
  buildRequest(request: ProtocolRequest): { url: string; init: RequestInit };
}

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

/** POST /synthesize com JSON. E o formato atual do Piper, Kokoro e F5. */
const synthesizeJson: LocalTtsProtocol = {
  id: 'synthesize',
  buildRequest({ baseUrl, text, voice, lengthScale, speed }) {
    const body: Record<string, unknown> = { text };
    if (voice) body['voice'] = voice;
    if (lengthScale && lengthScale !== 1) body['length_scale'] = lengthScale;
    if (speed && speed !== 1) body['speed'] = speed;

    return {
      url: `${baseUrl}/synthesize`,
      init: { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }
    };
  }
};

/** POST / com o texto cru no corpo. Formato antigo do piper.http_server. */
const postPlainText: LocalTtsProtocol = {
  id: 'post-text',
  buildRequest({ baseUrl, text }) {
    return {
      url: `${baseUrl}/`,
      init: { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text }
    };
  }
};

/** GET /?text=... Formato mais antigo ainda, mantido por compatibilidade. */
const getQueryString: LocalTtsProtocol = {
  id: 'get',
  buildRequest({ baseUrl, text }) {
    return { url: `${baseUrl}/?text=${encodeURIComponent(text)}`, init: { method: 'GET' } };
  }
};

/** Servidores compativeis com a API da OpenAI, como o openedai-speech. */
const openAiCompatible: LocalTtsProtocol = {
  id: 'openai',
  buildRequest({ baseUrl, text, voice }) {
    return {
      url: baseUrl,
      init: {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: voice ?? 'alloy',
          response_format: 'mp3'
        })
      }
    };
  }
};

/** Ordem de tentativa: do formato mais provavel para o mais antigo. */
export const LOCAL_TTS_PROTOCOLS: readonly LocalTtsProtocol[] = [
  synthesizeJson,
  postPlainText,
  getQueryString
];

export const OPENAI_PROTOCOL = openAiCompatible;

/** URL terminada em /v1/audio/speech indica servidor no formato da OpenAI. */
export function looksLikeOpenAi(baseUrl: string): boolean {
  return /\/v1\/audio\/speech$/.test(baseUrl);
}

/**
 * Respostas que indicam "formato errado, tente outro". Qualquer outro status e
 * problema real do servidor e nao adianta insistir em outro formato.
 */
export const WRONG_PROTOCOL_STATUSES: readonly number[] = [400, 404, 405, 422];
