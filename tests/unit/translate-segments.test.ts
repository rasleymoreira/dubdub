import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TranslateSegments } from '../../src/application/usecases/TranslateSegments.ts';
import { SILENT_REPORTER } from '../../src/application/ports/ProgressReporter.ts';
import { NEVER_CANCELED } from '../../src/application/services/CancellationToken.ts';
import type { TranslationPort } from '../../src/application/ports/TranslationPort.ts';
import type { TranslationRepository } from '../../src/application/ports/repositories.ts';
import type { SourceSegment } from '../../src/domain/entities/Segment.ts';

/** Repositorio em memoria: o caso de uso nao sabe que nao e IndexedDB. */
function fakeCache(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    repository: {
      async findMany(keys) {
        return keys.map((key) => store.get(key) ?? null);
      },
      async saveMany(entries) {
        for (const entry of entries) store.set(entry.key, entry.text);
      }
    } satisfies TranslationRepository
  };
}

function fakeTranslator(map: Record<string, string> = {}) {
  const calls: string[][] = [];
  const port: TranslationPort = {
    async translate(request) {
      calls.push([...request.texts]);
      return request.texts.map((text) => map[text] ?? `[pt] ${text}`);
    }
  };
  return { port, calls };
}

const segments = (...texts: string[]): SourceSegment[] =>
  texts.map((text, index) => ({ start: index, end: index + 1, text }));

function build(translator: TranslationPort, cache: TranslationRepository) {
  return new TranslateSegments({ translator, cache, reporter: SILENT_REPORTER });
}

const run = (useCase: TranslateSegments, input: SourceSegment[]) =>
  useCase.execute({ segments: input, from: 'en', to: 'pt-BR', signal: NEVER_CANCELED });

describe('TranslateSegments', () => {
  it('traduz tudo quando o cache esta vazio', async () => {
    const { port } = fakeTranslator({ hello: 'ola', world: 'mundo' });
    const { repository } = fakeCache();

    const result = await run(build(port, repository), segments('hello', 'world'));

    assert.deepEqual(result, ['ola', 'mundo']);
  });

  it('preenche o cache para a proxima chamada', async () => {
    const { port } = fakeTranslator({ hello: 'ola' });
    const { repository, store } = fakeCache();

    await run(build(port, repository), segments('hello'));

    assert.equal(store.size, 1);
  });

  it('nao chama o tradutor quando tudo ja esta em cache', async () => {
    const { port, calls } = fakeTranslator();
    const { repository } = fakeCache();

    const useCase = build(port, repository);
    await run(useCase, segments('hello'));
    calls.length = 0;

    const segunda = await run(useCase, segments('hello'));

    assert.deepEqual(calls, [], 'o tradutor nao deveria ser chamado de novo');
    assert.deepEqual(segunda, ['[pt] hello']);
  });

  it('pede so os trechos que faltam, preservando as posicoes', async () => {
    const { port, calls } = fakeTranslator();
    const { repository } = fakeCache();
    const useCase = build(port, repository);

    await run(useCase, segments('cached'));
    calls.length = 0;

    const result = await run(useCase, segments('cached', 'novo', 'outro'));

    assert.deepEqual(calls, [['novo', 'outro']], 'so os ausentes vao para a rede');
    assert.deepEqual(result, ['[pt] cached', '[pt] novo', '[pt] outro']);
  });

  it('traducao vazia cai para o texto original em vez de trecho mudo', async () => {
    const port: TranslationPort = { async translate(request) { return request.texts.map(() => ''); } };
    const { repository } = fakeCache();

    const result = await run(build(port, repository), segments('keep me'));

    assert.deepEqual(result, ['keep me']);
  });

  it('lista vazia nao chama o tradutor', async () => {
    const { port, calls } = fakeTranslator();
    const { repository } = fakeCache();

    assert.deepEqual(await run(build(port, repository), []), []);
    assert.deepEqual(calls, []);
  });

  it('o cache separa por idioma de destino', async () => {
    const { port, calls } = fakeTranslator();
    const { repository } = fakeCache();
    const useCase = build(port, repository);

    await useCase.execute({
      segments: segments('hello'),
      from: 'en',
      to: 'pt-BR',
      signal: NEVER_CANCELED
    });
    calls.length = 0;

    await useCase.execute({
      segments: segments('hello'),
      from: 'en',
      to: 'es',
      signal: NEVER_CANCELED
    });

    assert.deepEqual(calls, [['hello']], 'destino diferente e traducao diferente');
  });
});
