import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addContinuityPunctuation,
  normalizeForSpeech,
  polishForSpeech
} from '../../src/domain/services/SpeechTextPolisher.ts';

describe('normalizeForSpeech', () => {
  it('limpa uma legenda automatica tipica', () => {
    const sujo = [
      '[MUSIC]',
      '>> INSTRUCTOR: so in this lecture we are',
      'going to create a remote func-',
      'tion that runs on the the server...'
    ].join('\n');

    const limpo = normalizeForSpeech(sujo, { dedupe: true });

    assert.doesNotMatch(limpo, /\[MUSIC\]/i, 'marcacao de nao-fala deveria sumir');
    assert.doesNotMatch(limpo, /INSTRUCTOR/i, 'rotulo de locutor deveria sumir');
    assert.doesNotMatch(limpo, /\n/, 'quebras de linha viram frase corrida');
    assert.match(limpo, /function/, 'palavra cortada na quebra deveria ser remontada');
    assert.doesNotMatch(limpo, /the the/i, 'palavra repetida deveria colapsar');
    assert.doesNotMatch(limpo, /\.\.\./, 'reticencias viram pausa');
    assert.match(limpo, /^[A-Z]/, 'comeca com maiuscula');
  });

  it('legenda em caixa alta vira frase normal', () => {
    assert.equal(
      normalizeForSpeech('WELCOME TO THE COURSE ABOUT FUNCTIONS'),
      'Welcome to the course about functions'
    );
  });

  it('corrige espaco antes da pontuacao', () => {
    assert.equal(normalizeForSpeech('Isso é importante , sabia ?'), 'Isso é importante, sabia?');
  });

  it('nao estraga numero com ponto de milhar', () => {
    assert.equal(normalizeForSpeech('O valor é 1.500 reais.'), 'O valor é 1.500 reais.');
  });

  it('remove marcador de nao-fala entre parenteses, mas preserva parentese normal', () => {
    assert.doesNotMatch(normalizeForSpeech('Vamos comecar (applause) agora.'), /applause/i);
    assert.match(normalizeForSpeech('Use a funcao (a mais rapida) aqui.'), /a mais rapida/);
  });

  it('dedupe fica desligado por padrao', () => {
    assert.match(normalizeForSpeech('the the server'), /the the/i);
  });

  it('nao quebra com entrada vazia', () => {
    assert.equal(normalizeForSpeech(''), '');
  });
});

describe('addContinuityPunctuation', () => {
  it('frase que continua recebe virgula e a que termina recebe ponto', () => {
    const resultado = addContinuityPunctuation([
      'nesta aula vamos criar uma função',
      'que roda no servidor',
      'Depois disso, testamos'
    ]);

    assert.ok(resultado[0]?.endsWith(','), `esperado virgula, veio: ${resultado[0]}`);
    assert.ok(resultado[1]?.endsWith('.'), `esperado ponto, veio: ${resultado[1]}`);
    assert.ok(resultado[2]?.endsWith('.'), `ultimo trecho sempre fecha: ${resultado[2]}`);
  });

  it('respeita pontuacao que ja existe', () => {
    assert.deepEqual(addContinuityPunctuation(['Pronto!', 'Vamos.']), ['Pronto!', 'Vamos.']);
  });

  it('nao muta o array recebido', () => {
    const original = ['um', 'dois'];
    const copia = [...original];
    addContinuityPunctuation(original);
    assert.deepEqual(original, copia, 'a funcao deve ser pura');
  });
});

describe('polishForSpeech', () => {
  it('normaliza e pontua em uma passada', () => {
    const resultado = polishForSpeech([
      '>> JOHN: primeiro abrimos o editor',
      'depois criamos a classe'
    ]);
    assert.doesNotMatch(resultado[0]!, /JOHN/);
    assert.equal(resultado[0], 'Primeiro abrimos o editor,');
    assert.equal(resultado[1], 'depois criamos a classe.');
  });

  it('capitaliza so quem comeca frase de verdade', () => {
    const resultado = polishForSpeech([
      'primeira oracao termina aqui.',
      'esta comeca outra frase',
      'e esta continua a anterior'
    ]);
    assert.equal(resultado[0], 'Primeira oracao termina aqui.');
    assert.equal(resultado[1], 'Esta comeca outra frase,', 'depois de ponto, capitaliza');
    assert.equal(resultado[2], 'e esta continua a anterior.', 'depois de virgula, minuscula');
  });

  it('regressao: a virgula de continuidade nao pode voltar a morrer', () => {
    // Antes da correcao a capitalizacao rodava dentro de normalizeForSpeech,
    // ou seja antes da continuidade, e TODO trecho terminava em ponto.
    const resultado = polishForSpeech(['nesta aula vamos criar', 'uma funcao remota']);
    assert.ok(
      resultado[0]?.endsWith(','),
      `a oracao continua no proximo trecho, deveria fechar em virgula: ${resultado[0]}`
    );
  });
});
