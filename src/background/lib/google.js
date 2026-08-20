/*
 * Tradutor e TTS do Google Translate (endpoints publicos usados pela propria
 * pagina do tradutor, sem API key). Sao endpoints nao-oficiais: por isso todo
 * acesso passa por throttle, retry e validacao do content-type.
 */

import { HttpError, bytesToBase64, isRetriableHttp, sleep, withRetry } from './queue.js';
import { chunkText } from './segments.js';

const TRANSLATE_HOST = 'https://translate.googleapis.com';
const TTS_HOSTS = ['https://translate.googleapis.com', 'https://translate.google.com'];

const TTS_MAX_CHARS = 180;
const TRANSLATE_MAX_CHARS = 1200;
const TRANSLATE_MAX_LINES = 20;
const TTS_MIN_INTERVAL_MS = 120;

/** Serializa o inicio das requisicoes de TTS para nao levar 429. */
let ttsGate = Promise.resolve();
function throttleTts() {
  const next = ttsGate.then(() => sleep(TTS_MIN_INTERVAL_MS));
  ttsGate = next;
  return next;
}

function translateLangCode(code) {
  const map = { 'pt-BR': 'pt', pt: 'pt', 'pt-PT': 'pt-PT', 'en-US': 'en', 'en-GB': 'en' };
  return map[code] || code;
}

function ttsLangCode(code) {
  const map = { 'pt-BR': 'pt-BR', pt: 'pt-BR', 'pt-PT': 'pt-PT' };
  return map[code] || code;
}

function looksLikeBlockPage(text) {
  return /unusual traffic|captcha|<html/i.test(text.slice(0, 400));
}

/**
 * Traduz varias linhas em uma requisicao. O Google devolve os fragmentos na
 * ordem e preserva os \n, entao remontamos e conferimos a contagem; se nao
 * casar, o chamador refaz linha por linha.
 */
async function translateJoined(lines, from, to, token) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: from === 'auto' ? 'auto' : translateLangCode(from),
    tl: translateLangCode(to),
    dt: 't',
    q: lines.join('\n')
  });

  const data = await withRetry(
    async () => {
      if (token) token.check();
      const response = await fetch(TRANSLATE_HOST + '/translate_a/single?' + params.toString());
      const text = await response.text();
      if (!response.ok) throw new HttpError(response.status, 'Google Translate ' + response.status, text);
      if (looksLikeBlockPage(text)) throw new HttpError(429, 'Google Translate bloqueou a requisicao');
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpError(502, 'Resposta inesperada do Google Translate', text.slice(0, 200));
      }
    },
    { tries: 4, baseDelay: 800, shouldRetry: isRetriableHttp }
  );

  const fragments = Array.isArray(data?.[0]) ? data[0] : [];
  const joined = fragments.map((fragment) => (fragment && fragment[0]) || '').join('');
  const result = joined.split('\n');

  // o Google as vezes engole linhas vazias no fim
  while (result.length < lines.length) result.push('');
  if (result.length !== lines.length) return null;
  return result.map((value, index) => value.trim() || lines[index]);
}

/**
 * Traduz uma lista de textos preservando indices. Agrupa em lotes por tamanho
 * e cai para requisicao individual quando o lote desalinha.
 */
export async function translateAll({ texts, from, to, token, onProgress }) {
  const output = new Array(texts.length).fill('');
  const batches = [];
  let batch = [];
  let batchChars = 0;

  texts.forEach((text, index) => {
    const value = String(text || '').replace(/\s*\n\s*/g, ' ').trim();
    const length = value.length;
    if (batch.length >= TRANSLATE_MAX_LINES || batchChars + length > TRANSLATE_MAX_CHARS) {
      if (batch.length) batches.push(batch);
      batch = [];
      batchChars = 0;
    }
    batch.push({ index, value });
    batchChars += length + 1;
  });
  if (batch.length) batches.push(batch);

  let done = 0;
  for (const group of batches) {
    if (token) token.check();
    const lines = group.map((item) => item.value);
    let translated = null;
    try {
      translated = await translateJoined(lines, from, to, token);
    } catch (error) {
      if (error?.name === 'CanceledError') throw error;
      translated = null;
    }

    if (!translated) {
      translated = [];
      for (const line of lines) {
        const single = await translateJoined([line], from, to, token);
        translated.push(single ? single[0] : line);
      }
    }

    group.forEach((item, position) => {
      output[item.index] = translated[position] || item.value;
    });
    done += group.length;
    if (onProgress) onProgress(done, texts.length);
  }

  return output;
}

/**
 * Gera a voz de um texto. Como o endpoint limita ~200 caracteres, um segmento
 * pode virar varias partes de mp3 que o player toca em sequencia.
 */
export async function speak({ text, lang, token }) {
  const pieces = chunkText(text, TTS_MAX_CHARS);
  const parts = [];

  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    const audio = await withRetry(
      async (attempt) => {
        if (token) token.check();
        await throttleTts();
        const host = TTS_HOSTS[attempt % TTS_HOSTS.length];
        const params = new URLSearchParams({
          ie: 'UTF-8',
          client: 'tw-ob',
          tl: ttsLangCode(lang),
          ttsspeed: '1',
          total: String(pieces.length),
          idx: String(index),
          textlen: String(piece.length),
          q: piece
        });
        const response = await fetch(host + '/translate_tts?' + params.toString());
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new HttpError(response.status, 'Google TTS ' + response.status, body);
        }
        const mime = response.headers.get('content-type') || '';
        if (!/audio/i.test(mime)) {
          throw new HttpError(429, 'Google TTS devolveu ' + (mime || 'conteudo desconhecido'));
        }
        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength) throw new HttpError(502, 'Google TTS devolveu audio vazio');
        return bytesToBase64(buffer);
      },
      { tries: 5, baseDelay: 900, shouldRetry: isRetriableHttp }
    );
    parts.push(audio);
  }

  return { parts, mime: 'audio/mpeg' };
}
