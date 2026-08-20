/*
 * Matematica da sincronia entre a dublagem e o video.
 *
 * Isto estava dentro da classe do player, misturado com <audio>, timers e
 * eventos do DOM — a parte mais delicada do projeto era tambem a mais dificil
 * de testar. Aqui sao funcoes puras: entram numeros, saem numeros.
 *
 * Ideia central: a frase traduzida quase nunca tem a mesma duracao da original,
 * mas o silencio ate a proxima fala conta como espaco util. So quando nem assim
 * cabe e que a voz e comprimida, ate o limite configurado.
 */

import type { TimeRange } from '../value-objects/TimeRange.ts';

/** Acima disso o Chrome silencia o audio, entao nao adianta pedir mais. */
export const MAX_PLAYBACK_RATE = 4;

/** Espaco minimo considerado, para nao dividir por zero em cues degeneradas. */
const MIN_BUDGET_SECONDS = 0.4;

/** Sem proxima fala, o ultimo trecho ganha esta folga depois do fim. */
const TRAILING_BUDGET_SECONDS = 2;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface Geometry {
  /** Fator de compressao da voz: 1 = sem compressao. */
  readonly fit: number;
  /** Espaco disponivel em segundos ate a proxima fala. */
  readonly budget: number;
  /** Duracao que a dublagem ocupa no tempo do video, ja comprimida. */
  readonly dubDuration: number;
}

export function computeGeometry(
  segment: TimeRange,
  nextSegment: TimeRange | undefined,
  clipDuration: number,
  maxSpeedup: number
): Geometry {
  const horizon = nextSegment ? nextSegment.start : segment.end + TRAILING_BUDGET_SECONDS;
  const budget = Math.max(MIN_BUDGET_SECONDS, horizon - segment.start);
  const fit = clamp(clipDuration / budget, 1, maxSpeedup);
  return { fit, budget, dubDuration: clipDuration / fit };
}

/**
 * Velocidade final do elemento <audio>: a do video multiplicada pela compressao
 * do trecho. Em video a 2x com trecho comprimido em 1.25x, a voz toca a 2.5x —
 * e com preservesPitch ligado, sem ficar fina.
 */
export function playbackRateFor(videoRate: number, fit: number): number {
  return clamp(videoRate * fit, 0.25, MAX_PLAYBACK_RATE);
}

/** Posicao dentro do clipe correspondente ao tempo atual do video. */
export function clipTimeFor(videoTime: number, segment: TimeRange, fit: number): number {
  return (videoTime - segment.start) * fit;
}

/**
 * Ultimo segmento que ja comecou e ainda esta dentro da propria janela.
 * `windowFor` devolve quanto tempo o segmento ocupa: a duracao real quando o
 * clipe ja foi carregado, uma estimativa quando ainda nao.
 */
export function findSegmentAt(
  segments: readonly TimeRange[],
  time: number,
  windowFor: (index: number) => number
): number {
  const tolerance = 0.03;
  let low = 0;
  let high = segments.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle]!.start <= time + tolerance) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (found === -1) return -1;
  const segment = segments[found]!;
  return time > segment.start + windowFor(found) ? -1 : found;
}

/** Primeiro segmento que comeca em `time` ou depois. */
export function firstIndexAfter(segments: readonly TimeRange[], time: number): number {
  let low = 0;
  let high = segments.length - 1;
  let found = segments.length;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle]!.start >= time) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return found;
}

export interface PartLocation {
  readonly partIndex: number;
  readonly offset: number;
}

/** Em qual parte do clipe (e em que ponto dela) cai um instante do trecho. */
export function locatePart(partDurations: readonly number[], clipTime: number): PartLocation {
  let accumulated = 0;
  for (let part = 0; part < partDurations.length; part++) {
    const partDuration = partDurations[part]!;
    if (clipTime < accumulated + partDuration || part === partDurations.length - 1) {
      return { partIndex: part, offset: Math.max(0, clipTime - accumulated) };
    }
    accumulated += partDuration;
  }
  return { partIndex: 0, offset: 0 };
}
