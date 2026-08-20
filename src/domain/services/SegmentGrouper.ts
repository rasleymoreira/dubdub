/*
 * Agrupamento de cues em unidades de fala.
 *
 * Legenda vem picada em linhas de 3 a 5 palavras. Traduzir e sintetizar linha a
 * linha piora a traducao (falta contexto) e multiplica requisicoes por dez.
 * Aqui as cues viram frases completas sempre que possivel.
 *
 * A decisao mais importante e a da pausa: se o intervalo entre duas cues passa
 * de PAUSE_COMMA_SECONDS, elas sao unidas com virgula em vez de espaco, entao o
 * sintetizador respeita o ritmo de quem fala em vez de atropelar a pausa.
 */

import type { CaptionCue } from '../entities/Lecture.ts';
import type { SourceSegment } from '../entities/Segment.ts';
import { normalizeForSpeech } from './SpeechTextPolisher.ts';

const MAX_GROUP_CHARS = 220;
const MAX_GROUP_SECONDS = 18;
const MAX_GAP_SECONDS = 1.0;
const PAUSE_COMMA_SECONDS = 0.35;
const MIN_CHARS_TO_CLOSE_SENTENCE = 60;
const SENTENCE_END = /[.!?…]["')\]]?$/;

interface OpenGroup {
  start: number;
  end: number;
  text: string;
}

export function groupCues(cues: readonly CaptionCue[]): SourceSegment[] {
  const segments: SourceSegment[] = [];
  let current: OpenGroup | null = null;

  const close = (): void => {
    if (!current) return;
    const text = normalizeForSpeech(current.text, { dedupe: true });
    if (text) segments.push({ start: current.start, end: current.end, text });
    current = null;
  };

  for (const cue of cues) {
    if (!cue.text) continue;

    if (!current) {
      current = { start: cue.start, end: cue.end, text: cue.text };
      continue;
    }

    // legenda repetida, comum em legenda automatica que reexibe a linha anterior
    if (cue.text === current.text.slice(-cue.text.length)) {
      current.end = Math.max(current.end, cue.end);
      continue;
    }

    const gap = cue.start - current.end;
    const separator = gap >= PAUSE_COMMA_SECONDS && !/[.,;:!?…]$/.test(current.text) ? ', ' : ' ';
    const merged = current.text + separator + cue.text;

    const sentenceFinished =
      SENTENCE_END.test(current.text) && current.text.length >= MIN_CHARS_TO_CLOSE_SENTENCE;
    const tooLong = merged.length > MAX_GROUP_CHARS;
    const tooSlow = cue.end - current.start > MAX_GROUP_SECONDS;

    if (sentenceFinished || tooLong || tooSlow || gap > MAX_GAP_SECONDS) {
      close();
      current = { start: cue.start, end: cue.end, text: cue.text };
      continue;
    }

    current.text = merged;
    current.end = Math.max(current.end, cue.end);
  }
  close();

  return clampOverlaps(segments).filter((segment) => segment.end > segment.start);
}

/** Impede que um segmento invada o inicio do proximo. */
function clampOverlaps(segments: readonly SourceSegment[]): SourceSegment[] {
  return segments.map((segment, index) => {
    const next = segments[index + 1];
    if (next && segment.end > next.start) return { ...segment, end: next.start };
    return segment;
  });
}
