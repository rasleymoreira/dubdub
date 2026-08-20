import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cuesToVtt, parseCaptions } from '../../src/domain/services/CaptionParser.ts';
import { groupCues } from '../../src/domain/services/SegmentGrouper.ts';
import { chunkText } from '../../src/domain/services/TextChunker.ts';

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.200
Hello and welcome to this course

2
00:00:03.300 --> 00:00:05.000
about JavaScript.

3
00:00:08.000 --> 00:00:10.500
<c.colorE5E5E5>In this lecture</c> we will build a small app.

4
00:00:10.600 --> 00:00:12.000
Let's get started!
`;

const segmentsFrom = (content: string) => groupCues(parseCaptions(content));

describe('parseCaptions', () => {
  it('le todas as cues', () => {
    assert.equal(parseCaptions(VTT).length, 4);
  });

  it('remove tags de estilo', () => {
    const cues = parseCaptions(VTT);
    assert.doesNotMatch(cues[2]!.text, /[<>]/);
  });

  it('aceita SRT, com virgula nos milissegundos', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\nUma linha em SRT\n';
    const cues = parseCaptions(srt);
    assert.equal(cues.length, 1);
    assert.equal(cues[0]?.start, 1);
    assert.equal(cues[0]?.end, 3.5);
  });

  it('ordena por tempo mesmo com cues fora de ordem', () => {
    const foraDeOrdem = [
      '00:00:05.000 --> 00:00:06.000',
      'segunda',
      '',
      '00:00:01.000 --> 00:00:02.000',
      'primeira',
      ''
    ].join('\n');
    assert.equal(parseCaptions(foraDeOrdem)[0]?.text, 'primeira');
  });

  it('ignora conteudo sem timestamp em vez de quebrar', () => {
    assert.deepEqual(parseCaptions('WEBVTT\n\nlixo sem timestamp\n'), []);
  });
});

describe('groupCues', () => {
  it('junta cues da mesma frase e separa nas quebras', () => {
    const segments = segmentsFrom(VTT);
    assert.equal(segments.length, 2);
    assert.match(segments[0]!.text, /welcome.*JavaScript\.$/);
  });

  it('preserva os tempos de inicio', () => {
    const segments = segmentsFrom(VTT);
    assert.equal(segments[0]?.start, 1);
    assert.equal(segments[1]?.start, 8);
  });

  it('nao produz segmentos sobrepostos', () => {
    const segments = segmentsFrom(VTT);
    segments.forEach((segment, index) => {
      if (index === 0) return;
      assert.ok(segment.start >= segments[index - 1]!.end, 'segmento invadiu o anterior');
    });
  });

  it('pausa audivel do palestrante vira virgula', () => {
    const comPausa = segmentsFrom(
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nfirst we open the editor\n\n' +
        '00:00:03.600 --> 00:00:05.000\nthen we create the class\n'
    );
    assert.match(comPausa[0]!.text, /editor,\s+then/i);
  });

  it('fala continua nao ganha virgula', () => {
    const semPausa = segmentsFrom(
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nfirst we open the editor\n\n' +
        '00:00:03.050 --> 00:00:05.000\nthen we create the class\n'
    );
    assert.doesNotMatch(semPausa[0]!.text, /editor,/i);
  });

  it('colapsa legenda automatica que reexibe a linha anterior', () => {
    const repetida = segmentsFrom(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nabrindo o editor\n\n' +
        '00:00:02.000 --> 00:00:03.000\nabrindo o editor\n'
    );
    assert.equal(repetida.length, 1);
  });

  it('devolve lista vazia sem cues', () => {
    assert.deepEqual(groupCues([]), []);
  });
});

describe('cuesToVtt', () => {
  it('faz round-trip pelo parser', () => {
    const original = [
      { start: 1.5, end: 3.25, text: 'primeira fala' },
      { start: 4, end: 6, text: 'segunda fala' }
    ];
    const relido = parseCaptions(cuesToVtt(original));
    assert.equal(relido.length, 2);
    assert.equal(relido[0]?.text, 'primeira fala');
    assert.ok(Math.abs(relido[0]!.start - 1.5) < 0.01);
  });
});

describe('chunkText', () => {
  const longo = 'Frase um bem comprida para forcar a quebra do texto. '.repeat(8);

  it('respeita o limite por requisicao', () => {
    for (const piece of chunkText(longo, 180)) {
      assert.ok(piece.length <= 180, `pedaco de ${piece.length} chars passou do limite`);
    }
  });

  it('nao perde conteudo', () => {
    const juntos = chunkText(longo, 180).join(' ').replace(/\s+/g, ' ').trim();
    assert.ok(juntos.length >= longo.trim().length - 10);
  });

  it('texto curto sai inteiro em um pedaco', () => {
    assert.deepEqual(chunkText('Uma frase curta.', 180), ['Uma frase curta.']);
  });

  it('texto vazio nao gera pedaco nenhum', () => {
    assert.deepEqual(chunkText('   ', 180), []);
  });

  it('quebra por palavra quando nem a virgula resolve', () => {
    const semPontuacao = 'palavra '.repeat(60).trim();
    for (const piece of chunkText(semPontuacao, 50)) {
      assert.ok(piece.length <= 50);
    }
  });
});
