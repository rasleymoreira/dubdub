/**
 * Executa `worker` sobre `items` com no maximo `limit` chamadas simultaneas.
 *
 * O limite existe porque cada provedor tem um teto diferente: o Google TTS usa
 * endpoint publico e leva 429 acima de 2, o F5-TTS serializa a inferencia na
 * GPU e nao ganha nada acima de 1.
 */

import type { CancellationSignal } from './CancellationToken.ts';

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: CancellationSignal
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      signal?.throwIfCanceled();
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: workers }, run));
  return results;
}
