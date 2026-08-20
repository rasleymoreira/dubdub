/*
 * Ordem em que os trechos sao sintetizados.
 *
 * Gerar do inicio ao fim significa esperar a aula inteira antes de ouvir
 * qualquer coisa. Comecando pelo ponto onde o video esta, da para dar play e ir
 * ouvindo enquanto o resto e gerado; o que ficou para tras entra depois, para
 * que voltar no video tambem funcione.
 */

import type { TimeRange } from '../value-objects/TimeRange.ts';

export interface SynthesisOrderInput {
  readonly segments: readonly TimeRange[];
  readonly startAt: number;
  readonly startFromPlayhead: boolean;
  /** Indices que ja tem audio no cache e nao precisam ser refeitos. */
  readonly alreadyDone: ReadonlySet<number>;
}

export function synthesisOrder(input: SynthesisOrderInput): number[] {
  const all = input.segments.map((_, index) => index);
  const ordered =
    !input.startFromPlayhead || !input.startAt
      ? all
      : [
          ...all.filter((index) => input.segments[index]!.end >= input.startAt),
          ...all.filter((index) => input.segments[index]!.end < input.startAt)
        ];

  return ordered.filter((index) => !input.alreadyDone.has(index));
}
