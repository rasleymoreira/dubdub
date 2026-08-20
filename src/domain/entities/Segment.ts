/**
 * Segmentos de fala.
 *
 * Ha dois estagios e eles nao sao intercambiaveis, por isso sao tipos distintos:
 * o que sai do parser de legenda ainda nao tem indice nem traducao; o que vai
 * para o cache e para o player tem os dois. Antes era o mesmo objeto solto
 * ganhando campos pelo caminho.
 */

import type { TimeRange } from '../value-objects/TimeRange.ts';

/** Trecho cru, recem-extraido da legenda ou da transcricao. */
export interface SourceSegment extends TimeRange {
  readonly text: string;
}

/** Trecho pronto: posicao fixa, texto original e texto dublado. */
export interface DubSegment extends TimeRange {
  readonly index: number;
  readonly sourceText: string;
  readonly targetText: string;
}

export function toDubSegment(
  segment: SourceSegment,
  index: number,
  targetText: string
): DubSegment {
  return {
    index,
    start: segment.start,
    end: segment.end,
    sourceText: segment.text,
    targetText
  };
}
