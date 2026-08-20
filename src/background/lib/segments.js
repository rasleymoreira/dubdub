/*
 * Conversao de legendas (VTT/SRT) e de utterances do Deepgram em segmentos de
 * fala prontos para traduzir e sintetizar.
 */

import { normalizeForSpeech } from './text.js';

const MAX_GROUP_CHARS = 220;
const MAX_GROUP_SECONDS = 18;
const MAX_GAP_SECONDS = 1.0;
const PAUSE_COMMA_SECONDS = 0.35; // pausa do palestrante vira virgula no texto
const SENTENCE_END = /[.!?…]["')\]]?$/;

function parseTimestamp(raw) {
  const value = raw.trim().replace(',', '.');
  const parts = value.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/** Remove tags de estilo/karaoke e normaliza espacos de uma linha de legenda. */
function cleanCueText(text) {
  return text
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le um arquivo WebVTT ou SRT e devolve as cues cruas em ordem de tempo. */
export function parseCaptions(content) {
  const lines = String(content).replace(/\r/g, '').split('\n');
  const cues = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const arrow = line.indexOf('-->');
    if (arrow === -1) {
      index++;
      continue;
    }
    const start = parseTimestamp(line.slice(0, arrow));
    const endRaw = line.slice(arrow + 3).trim().split(/\s+/)[0];
    const end = parseTimestamp(endRaw);
    index++;

    const textLines = [];
    while (index < lines.length && lines[index].trim() !== '') {
      textLines.push(lines[index]);
      index++;
    }
    const text = cleanCueText(textLines.join(' '));
    if (start !== null && end !== null && end > start && text) cues.push({ start, end, text });
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/**
 * Junta cues curtas em unidades de fala (idealmente frases completas): melhora
 * muito a qualidade da traducao e evita uma requisicao de TTS por linha.
 */
export function groupCues(cues) {
  const segments = [];
  let current = null;

  const close = () => {
    if (current && current.text) {
      current.text = normalizeForSpeech(current.text, { dedupe: true });
      if (current.text) segments.push(current);
    }
    current = null;
  };

  for (const cue of cues) {
    const text = cue.text;
    if (!text) continue;

    if (!current) {
      current = { start: cue.start, end: cue.end, text };
      continue;
    }

    // legenda repetida (comum em legendas automaticas)
    if (text === current.text.slice(-text.length)) {
      current.end = Math.max(current.end, cue.end);
      continue;
    }

    const gap = cue.start - current.end;
    // pausa audivel vira virgula: o sintetizador respeita o ritmo de quem fala
    const separator =
      gap >= PAUSE_COMMA_SECONDS && !/[.,;:!?…]$/.test(current.text) ? ', ' : ' ';
    const merged = current.text + separator + text;
    const finished = SENTENCE_END.test(current.text) && current.text.length >= 60;
    const tooLong = merged.length > MAX_GROUP_CHARS;
    const tooSlow = cue.end - current.start > MAX_GROUP_SECONDS;

    if (finished || tooLong || tooSlow || gap > MAX_GAP_SECONDS) {
      close();
      current = { start: cue.start, end: cue.end, text };
      continue;
    }

    current.text = merged;
    current.end = Math.max(current.end, cue.end);
  }
  close();

  // impede que um segmento invada o inicio do proximo
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].end > segments[i + 1].start) segments[i].end = segments[i + 1].start;
  }

  return segments.filter((s) => s.end > s.start);
}

export function segmentsFromCaptions(content) {
  return groupCues(parseCaptions(content));
}

/** Utterances do Deepgram ja vem no tamanho de frase; so normalizamos. */
export function segmentsFromDeepgram(result) {
  const utterances = result?.results?.utterances;
  if (Array.isArray(utterances) && utterances.length) {
    return groupCues(
      utterances
        .map((u) => ({
          start: Number(u.start) || 0,
          end: Number(u.end) || 0,
          text: cleanCueText(u.transcript || '')
        }))
        .filter((u) => u.text && u.end > u.start)
    );
  }

  // fallback: paragrafos do smart_format
  const paragraphs = result?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.paragraphs;
  if (Array.isArray(paragraphs) && paragraphs.length) {
    const cues = [];
    for (const paragraph of paragraphs) {
      for (const sentence of paragraph.sentences || []) {
        const text = cleanCueText(sentence.text || '');
        if (text) cues.push({ start: sentence.start, end: sentence.end, text });
      }
    }
    return groupCues(cues);
  }

  return [];
}

/**
 * Quebra um texto em pedacos de no maximo `maxLen` caracteres respeitando
 * pontuacao (o TTS do Google Translate limita o tamanho por requisicao).
 */
export function chunkText(text, maxLen) {
  const clean = String(text).trim();
  if (clean.length <= maxLen) return clean ? [clean] : [];

  const pieces = [];
  let buffer = '';

  const flush = () => {
    const value = buffer.trim();
    if (value) pieces.push(value);
    buffer = '';
  };

  // primeiro por frase, depois por virgula, por fim por palavra
  const sentences = clean.match(/[^.!?…;]+[.!?…;]*\s*/g) || [clean];
  for (const sentence of sentences) {
    if ((buffer + sentence).trim().length <= maxLen) {
      buffer += sentence;
      continue;
    }
    flush();
    if (sentence.trim().length <= maxLen) {
      buffer = sentence;
      continue;
    }
    for (const part of sentence.split(/(?<=,)\s*/)) {
      if ((buffer + part).trim().length <= maxLen) {
        buffer += part;
        continue;
      }
      flush();
      if (part.trim().length <= maxLen) {
        buffer = part;
        continue;
      }
      for (const word of part.split(/\s+/)) {
        if ((buffer + ' ' + word).trim().length <= maxLen) {
          buffer += (buffer ? ' ' : '') + word;
        } else {
          flush();
          buffer = word.slice(0, maxLen);
        }
      }
    }
  }
  flush();
  return pieces;
}
