/*
 * Cliente para servidores de TTS locais (Piper e Kokoro).
 *
 * Os dois expoem o mesmo contrato:
 *   POST /synthesize  {"text": "...", "voice": "..."}  -> WAV
 *   POST /            corpo em text/plain              -> WAV
 *   GET  /?text=...                                    -> WAV
 *
 * Servidores diferentes aceitam formatos diferentes (o piper.http_server variou
 * entre versoes), entao tentamos os tres e memorizamos o que funcionou por URL.
 * Tambem aceitamos servidores compativeis com a API da OpenAI.
 */

import { HttpError, bytesToBase64, isRetriableHttp, withRetry } from './queue.js';

const MODES = ['synthesize', 'post-text', 'get'];

/** base -> formato que funcionou, para nao tentar os tres toda vez. */
const workingMode = new Map();

function normalizeBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function isOpenAiStyle(base) {
  return /\/v1\/audio\/speech$/.test(base);
}

function callMode(base, mode, { voice, text, lengthScale, speed }) {
  if (mode === 'openai') {
    return fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text, voice, response_format: 'mp3' })
    });
  }
  if (mode === 'synthesize') {
    const body = { text, voice };
    if (lengthScale && lengthScale !== 1) body.length_scale = lengthScale;
    if (speed && speed !== 1) body.speed = speed;
    return fetch(base + '/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }
  if (mode === 'post-text') {
    return fetch(base + '/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text });
  }
  return fetch(base + '/?text=' + encodeURIComponent(text));
}

async function readAudio(response) {
  const type = response.headers.get('content-type') || '';
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new HttpError(502, 'servidor devolveu audio vazio');
  const mime = /audio|wav|mpeg/i.test(type) ? type.split(';')[0] : 'audio/wav';
  return { parts: [bytesToBase64(buffer)], mime };
}

/** Sintetiza um trecho. Descobre o formato do servidor na primeira chamada. */
export async function speak({ baseUrl, voice, text, lengthScale, speed, label, token }) {
  const base = normalizeBase(baseUrl);
  const name = label || 'servidor local';
  const known = workingMode.get(base);
  const modes = isOpenAiStyle(base) ? ['openai'] : known ? [known] : MODES;

  return withRetry(
    async () => {
      if (token) token.check();
      let lastError = null;

      for (const mode of modes) {
        let response;
        try {
          response = await callMode(base, mode, { voice, text, lengthScale, speed });
        } catch (error) {
          throw new HttpError(0, 'Nao consegui falar com o ' + name + ' em ' + base + ' (' + error.message + ')');
        }

        if (response.ok) {
          workingMode.set(base, mode);
          return readAudio(response);
        }

        const body = await response.text().catch(() => '');
        lastError = new HttpError(
          response.status,
          name + ' ' + response.status + ': ' + body.slice(0, 200),
          body
        );
        // 400/404/405/422 = formato errado: vale tentar o proximo
        if (![400, 404, 405, 422].includes(response.status)) throw lastError;
      }

      workingMode.delete(base);
      throw lastError || new HttpError(502, name + ' nao respondeu em nenhum formato conhecido');
    },
    { tries: 3, baseDelay: 500, shouldRetry: isRetriableHttp }
  );
}

/** Vozes que o servidor expoe (quando ele tem /voices). */
export async function listVoices({ baseUrl }) {
  const base = normalizeBase(baseUrl);
  const response = await fetch(base + '/voices');
  if (!response.ok) throw new HttpError(response.status, '/voices respondeu ' + response.status);
  const data = await response.json();
  if (Array.isArray(data)) return data.map((item) => item.key || item.name || String(item));
  if (Array.isArray(data?.voices)) return data.voices.map((item) => item.key || item.name || String(item));
  return Object.keys(data || {});
}

/** Dados do servidor quando ele expoe /info (o do Kokoro informa o dispositivo). */
export async function info({ baseUrl }) {
  const base = normalizeBase(baseUrl);
  try {
    const response = await fetch(base + '/info');
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** Checagem antes de um job: falha cedo e com mensagem util. */
export async function ping({ baseUrl, voice, label }) {
  const base = normalizeBase(baseUrl);
  let voices = null;
  try {
    voices = await listVoices({ baseUrl: base });
  } catch {
    voices = null; // servidor sem /voices continua valido
  }

  const details = await info({ baseUrl: base });
  const audio = await speak({ baseUrl: base, voice, text: 'ok', label });
  return { ok: true, voices, mode: workingMode.get(base), mime: audio.mime, info: details };
}
