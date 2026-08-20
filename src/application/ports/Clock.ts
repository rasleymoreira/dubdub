/**
 * Fonte de tempo.
 *
 * Injetada em vez de Date.now() direto para que testes de cache e de LRU sejam
 * deterministicos em vez de dependerem do relogio da maquina.
 */

export interface Clock {
  now(): number;
}

export const SYSTEM_CLOCK: Clock = { now: () => Date.now() };
