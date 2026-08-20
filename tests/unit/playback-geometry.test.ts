/**
 * Sincronia do player.
 *
 * Estes casos vinham da suite antiga, onde eram exercitados instanciando a
 * classe do player inteira com stubs de Audio, URL e <video>. Como a matematica
 * saiu para funcoes puras, o mesmo comportamento e verificado sem DOM nenhum.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clipTimeFor,
  computeGeometry,
  findSegmentAt,
  firstIndexAfter,
  locatePart,
  playbackRateFor,
  MAX_PLAYBACK_RATE
} from '../../src/domain/services/PlaybackGeometry.ts';
import { synthesisOrder } from '../../src/domain/services/SynthesisOrder.ts';

/** Duas falas: 0-2s e 4-6s. Entre elas ha 2s de silencio aproveitavel. */
const SEGMENTS = [
  { start: 0, end: 2 },
  { start: 4, end: 6 }
];

const MAX_SPEEDUP = 1.25;

describe('computeGeometry', () => {
  it('nao acelera quando a fala cabe no espaco ate a proxima', () => {
    const geometry = computeGeometry(SEGMENTS[0]!, SEGMENTS[1], 3, MAX_SPEEDUP);
    assert.equal(geometry.fit, 1);
    assert.equal(geometry.budget, 4, 'o silencio entre falas conta como espaco util');
  });

  it('acelera ate o limite quando nao cabe, e nao alem', () => {
    const geometry = computeGeometry(SEGMENTS[0]!, SEGMENTS[1], 6, MAX_SPEEDUP);
    assert.ok(Math.abs(geometry.fit - MAX_SPEEDUP) < 1e-9);
    assert.ok(Math.abs(geometry.dubDuration - 6 / MAX_SPEEDUP) < 1e-9);
  });

  it('o ultimo trecho ganha folga depois do fim', () => {
    const geometry = computeGeometry(SEGMENTS[1]!, undefined, 1, MAX_SPEEDUP);
    assert.equal(geometry.budget, 4, '6 - 4 + 2s de folga');
  });

  it('cue degenerada nao divide por zero', () => {
    const geometry = computeGeometry({ start: 5, end: 5 }, { start: 5, end: 5 }, 2, MAX_SPEEDUP);
    assert.ok(Number.isFinite(geometry.fit));
    assert.ok(geometry.budget > 0);
  });
});

describe('playbackRateFor', () => {
  it('video em 1x com trecho folgado toca em 1x', () => {
    assert.equal(playbackRateFor(1, 1), 1);
  });

  it('video em 2x toca a dublagem em 2x', () => {
    assert.equal(playbackRateFor(2, 1), 2);
  });

  it('2x combina com a compressao do trecho', () => {
    assert.ok(Math.abs(playbackRateFor(2, MAX_SPEEDUP) - 2.5) < 1e-9);
  });

  it('nunca passa do ponto em que o Chrome silencia o audio', () => {
    assert.equal(playbackRateFor(4, 2), MAX_PLAYBACK_RATE);
  });
});

describe('clipTimeFor', () => {
  it('sem compressao, a posicao no clipe acompanha o video', () => {
    assert.equal(clipTimeFor(1, SEGMENTS[0]!, 1), 1);
  });

  it('com compressao, a posicao no clipe anda mais rapido', () => {
    const { fit } = computeGeometry(SEGMENTS[0]!, SEGMENTS[1], 6, MAX_SPEEDUP);
    assert.ok(Math.abs(clipTimeFor(2, SEGMENTS[0]!, fit) - 2.5) < 0.01);
  });
});

describe('findSegmentAt', () => {
  const janelaEstimada = (index: number) => {
    const segment = SEGMENTS[index]!;
    return segment.end - segment.start + 1.5;
  };

  it('acha o trecho em reproducao', () => {
    assert.equal(findSegmentAt(SEGMENTS, 1, janelaEstimada), 0);
  });

  it('devolve -1 no silencio entre falas', () => {
    assert.equal(findSegmentAt(SEGMENTS, 3.9, janelaEstimada), -1);
  });

  it('devolve -1 antes da primeira fala', () => {
    assert.equal(
      findSegmentAt([{ start: 10, end: 12 }], 2, () => 3.5),
      -1
    );
  });

  it('um trecho comprimido ocupa menos tempo, entao a janela encurta', () => {
    const janelaCurta = () => 0.5;
    assert.equal(findSegmentAt(SEGMENTS, 1, janelaCurta), -1);
  });
});

describe('firstIndexAfter', () => {
  it('acha o proximo trecho a partir do silencio', () => {
    assert.equal(firstIndexAfter(SEGMENTS, 3), 1);
  });

  it('devolve o tamanho da lista quando nao ha mais nada', () => {
    assert.equal(firstIndexAfter(SEGMENTS, 99), SEGMENTS.length);
  });
});

describe('locatePart', () => {
  it('escolhe a parte certa de um trecho dividido em varios mp3', () => {
    const { partIndex, offset } = locatePart([2, 3], 3);
    assert.equal(partIndex, 1);
    assert.ok(Math.abs(offset - 1) < 1e-9);
  });

  it('tempo alem do fim cai na ultima parte', () => {
    assert.equal(locatePart([2, 3], 99).partIndex, 1);
  });

  it('trecho de uma parte so devolve offset direto', () => {
    assert.deepEqual(locatePart([5], 2), { partIndex: 0, offset: 2 });
  });
});

describe('synthesisOrder', () => {
  const segments = [
    { start: 0, end: 2 },
    { start: 4, end: 6 },
    { start: 8, end: 10 }
  ];

  it('comeca do ponto atual e depois volta para o que ficou atras', () => {
    const order = synthesisOrder({
      segments,
      startAt: 5,
      startFromPlayhead: true,
      alreadyDone: new Set()
    });
    assert.deepEqual(order, [1, 2, 0]);
  });

  it('com a opcao desligada gera na ordem natural', () => {
    const order = synthesisOrder({
      segments,
      startAt: 5,
      startFromPlayhead: false,
      alreadyDone: new Set()
    });
    assert.deepEqual(order, [0, 1, 2]);
  });

  it('pula o que ja esta no cache: e assim que Redublar retoma de onde parou', () => {
    const order = synthesisOrder({
      segments,
      startAt: 0,
      startFromPlayhead: true,
      alreadyDone: new Set([1])
    });
    assert.deepEqual(order, [0, 2]);
  });

  it('nada a fazer quando tudo ja foi sintetizado', () => {
    const order = synthesisOrder({
      segments,
      startAt: 0,
      startFromPlayhead: true,
      alreadyDone: new Set([0, 1, 2])
    });
    assert.deepEqual(order, []);
  });
});
