/*
 * Cliente do Deepgram: transcricao (nova-3) e voz (Aura-2).
 * Docs: https://developers.deepgram.com/docs
 */

import { HttpError, bytesToBase64, isRetriableHttp, withRetry } from './queue.js';
import { segmentsFromDeepgram } from './segments.js';

const API = 'https://api.deepgram.com/v1';

// Aura-2 aceita mp3, mas nem todo modelo/plano: memorizamos a decisao por sessao.
let mp3Supported = true;

function authHeaders(apiKey) {
  return { Authorization: 'Token ' + apiKey };
}

async function readError(response) {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    message = parsed.err_msg || parsed.reason || parsed.message || message;
  } catch {
    /* corpo nao-JSON */
  }
  return new HttpError(response.status, 'Deepgram ' + response.status + ': ' + message, body);
}

/** Confere se a API key responde (usado pelo botao "testar" do popup). */
export async function validateKey(apiKey) {
  const response = await fetch(API + '/projects', { headers: authHeaders(apiKey) });
  if (!response.ok) throw await readError(response);
  const data = await response.json();
  const projects = data.projects || [];
  return { ok: true, projects: projects.map((p) => p.name).filter(Boolean) };
}

/**
 * Transcreve uma midia remota (URL publica assinada da Udemy).
 * O Deepgram baixa a URL pelo lado dele, entao nao trafegamos o video.
 */
export async function transcribeUrl({ apiKey, model, language, mediaUrl, token }) {
  const params = new URLSearchParams({
    model: model || 'nova-3',
    smart_format: 'true',
    punctuate: 'true',
    utterances: 'true',
    utt_split: '0.8',
    filler_words: 'false'
  });
  if (!language || language === 'auto') params.set('detect_language', 'true');
  else params.set('language', language);

  const result = await withRetry(
    async () => {
      if (token) token.check();
      const response = await fetch(API + '/listen?' + params.toString(), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(apiKey)),
        body: JSON.stringify({ url: mediaUrl })
      });
      if (!response.ok) throw await readError(response);
      return response.json();
    },
    { tries: 2, baseDelay: 1500, shouldRetry: isRetriableHttp }
  );

  const segments = segmentsFromDeepgram(result);
  const detected = result?.results?.channels?.[0]?.detected_language;
  return { segments, detectedLanguage: detected || language };
}

/** Sintetiza um texto com uma voz Aura-2. Devolve audio em base64. */
export async function speak({ apiKey, model, text, token }) {
  return withRetry(
    async () => {
      if (token) token.check();
      const params = new URLSearchParams({ model: model || 'aura-2-thalia-en' });
      if (mp3Supported) {
        params.set('encoding', 'mp3');
        params.set('bit_rate', '48000');
      }
      const response = await fetch(API + '/speak?' + params.toString(), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(apiKey)),
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        const error = await readError(response);
        // alguns modelos rejeitam mp3: repete sem o parametro nas proximas chamadas
        if (mp3Supported && response.status === 400 && /encoding|bit_rate/i.test(error.body || '')) {
          mp3Supported = false;
          throw new HttpError(429, 'Deepgram: mp3 indisponivel, repetindo em wav', error.body);
        }
        throw error;
      }

      const mime = response.headers.get('content-type') || (mp3Supported ? 'audio/mpeg' : 'audio/wav');
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength) throw new HttpError(502, 'Deepgram devolveu audio vazio');
      return { parts: [bytesToBase64(buffer)], mime };
    },
    { tries: 4, baseDelay: 700, shouldRetry: isRetriableHttp }
  );
}
