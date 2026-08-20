/** Intervalo de tempo em segundos dentro do video. */

export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

export function duration(range: TimeRange): number {
  return Math.max(0, range.end - range.start);
}

export function contains(range: TimeRange, time: number): boolean {
  return time >= range.start && time < range.end;
}

/** Arredonda para milissegundos: evita ruido de ponto flutuante ao serializar. */
export function roundToMillis(value: number): number {
  return Number(value.toFixed(3));
}
