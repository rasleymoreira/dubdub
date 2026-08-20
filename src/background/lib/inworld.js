/*
 * Cliente do Inworld TTS (vozes neurais em pt-BR, entre elas a Heitor).
 * Docs: https://docs.inworld.ai
 *
 * POST /tts/v1/voice devolve JSON com o audio em base64 (MP3 por padrao), o que
 * cai direto no formato que o player da extensao ja consome.
 */

import { HttpError, isRetriableHttp, withRetry } from './queue.js';

const API = 'https://api.inworld.ai/tts/v1';

/** A key ja vem em base64 (chave:segredo); aceitamos com ou sem o prefixo. */
function authHeader(apiKey) {
  const value = String(apiKey || '').trim().replace(/^Basic\s+/i, '');
  return { Authorization: 'Basic ' + value, 'Content-Type': 'application/json' };
}

async function readError(response) {
  const body = await response.text().catch(() => '');
  let message = body.slice(0, 250);
  try {
    const parsed = JSON.parse(body);
    message = parsed.message || parsed.error?.message || message;
  } catch {
    /* corpo nao-JSON */
  }
  return new HttpError(response.status, 'Inworld ' + response.status + ': ' + message, body);
}

/** Credencial invalida nao melhora com retry. */
function retriable(error) {
  if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return false;
  return isRetriableHttp(error);
}

export async function speak({ apiKey, voiceId, model, bitRate, text, token }) {
  return withRetry(
    async () => {
      if (token) token.check();
      const body = {
        text,
        voiceId: voiceId || 'Heitor',
        modelId: model || 'inworld-tts-2',
        audioConfig: { audioEncoding: 'MP3' }
      };
      if (bitRate) body.audioConfig.bitRate = Number(bitRate);

      const response = await fetch(API + '/voice', {
        method: 'POST',
        headers: authHeader(apiKey),
        body: JSON.stringify(body)
      });
      if (!response.ok) throw await readError(response);

      const data = await response.json();
      const audio = data.audioContent || data.audio_content;
      if (!audio) throw new HttpError(502, 'Inworld nao devolveu audio');
      return { parts: [audio], mime: 'audio/mpeg', characters: data.usage?.processedCharactersCount || 0 };
    },
    { tries: 4, baseDelay: 700, shouldRetry: retriable }
  );
}

/** Vozes disponiveis, opcionalmente filtradas por idioma ('pt', 'en', ...). */
export async function listVoices({ apiKey, language }) {
  const query = language ? '?filter=language=' + encodeURIComponent(language) : '';
  const response = await fetch(API + '/voices' + query, { headers: authHeader(apiKey) });
  if (!response.ok) throw await readError(response);
  const data = await response.json();
  return (data.voices || []).map((voice) => ({
    id: voice.voiceId,
    name: voice.displayName || voice.voiceId,
    description: voice.description || '',
    languages: voice.languages || []
  }));
}

/** Checagem antes do job: confirma credencial e se a voz existe mesmo. */
export async function preflight({ apiKey, voiceId, language, notes }) {
  const voices = await listVoices({ apiKey, language });
  if (voices.length && !voices.some((voice) => voice.id === voiceId)) {
    const nomes = voices.slice(0, 6).map((voice) => voice.id).join(', ');
    (notes || []).push(
      'Voz "' + voiceId + '" nao aparece nas vozes de ' + language + '. Disponiveis: ' + nomes
    );
  }
  return { ok: true, voices };
}
