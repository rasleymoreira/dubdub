/*
 * Cliente do ElevenLabs (voz em pt-BR de verdade, com custo por caractere).
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
 */

import { HttpError, bytesToBase64, isRetriableHttp, withRetry } from './queue.js';

const API = 'https://api.elevenlabs.io/v1';

function headers(apiKey, json) {
  const base = { 'xi-api-key': apiKey };
  if (json) base['Content-Type'] = 'application/json';
  return base;
}

async function readError(response) {
  const body = await response.text().catch(() => '');
  let message = body.slice(0, 250);
  try {
    const parsed = JSON.parse(body);
    const detail = parsed.detail;
    message = (typeof detail === 'string' ? detail : detail?.message) || message;
  } catch {
    /* corpo nao-JSON */
  }
  return new HttpError(response.status, 'ElevenLabs ' + response.status + ': ' + message, body);
}

/** Erros de credito/pagamento nao adianta repetir. */
function retriable(error) {
  if (error instanceof HttpError && error.status === 401) return false;
  return isRetriableHttp(error);
}

export async function speak({ apiKey, voiceId, model, format, text, token }) {
  return withRetry(
    async () => {
      if (token) token.check();
      const params = new URLSearchParams({ output_format: format || 'mp3_22050_32' });
      const response = await fetch(
        API + '/text-to-speech/' + encodeURIComponent(voiceId) + '?' + params.toString(),
        {
          method: 'POST',
          headers: headers(apiKey, true),
          body: JSON.stringify({ text, model_id: model || 'eleven_flash_v2_5' })
        }
      );
      if (!response.ok) throw await readError(response);
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength) throw new HttpError(502, 'ElevenLabs devolveu audio vazio');
      return { parts: [bytesToBase64(buffer)], mime: 'audio/mpeg' };
    },
    { tries: 4, baseDelay: 800, shouldRetry: retriable }
  );
}

export async function listVoices({ apiKey }) {
  const response = await fetch(API + '/voices', { headers: headers(apiKey) });
  if (!response.ok) throw await readError(response);
  const data = await response.json();
  return (data.voices || []).map((voice) => ({
    id: voice.voice_id,
    name: voice.name,
    category: voice.category
  }));
}

/** Creditos restantes: usado para avisar antes de um job grande. */
export async function getQuota({ apiKey }) {
  const response = await fetch(API + '/user/subscription', { headers: headers(apiKey) });
  if (!response.ok) throw await readError(response);
  const data = await response.json();
  const used = Number(data.character_count) || 0;
  const limit = Number(data.character_limit) || 0;
  return {
    tier: data.tier || '',
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: data.next_character_count_reset_unix ? data.next_character_count_reset_unix * 1000 : null
  };
}

/**
 * Checagem antes do job: confirma a key, mede o credito restante e compara com
 * o tamanho do texto que sera sintetizado.
 */
export async function preflight({ apiKey, voiceId, neededChars }) {
  const quota = await getQuota({ apiKey });
  const notes = [];
  if (neededChars && quota.limit && quota.remaining < neededChars) {
    notes.push(
      'ElevenLabs: restam ' +
        quota.remaining.toLocaleString('pt-BR') +
        ' caracteres e esta aula precisa de ~' +
        neededChars.toLocaleString('pt-BR') +
        '. O que passar do limite vai falhar.'
    );
  }

  // uma sintese minima revela problemas de pagamento/permissao antes do job
  await speak({ apiKey, voiceId, text: 'ok', model: 'eleven_flash_v2_5', format: 'mp3_22050_32' });
  return { ok: true, quota, notes };
}
