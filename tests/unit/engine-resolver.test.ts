import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveEngines,
  type EngineResolutionInput
} from '../../src/domain/services/EngineResolver.ts';
import { CAPABILITIES } from '../fixtures/capabilities.ts';

function input(overrides: Partial<EngineResolutionInput> = {}): EngineResolutionInput {
  return {
    preset: 'deepgram',
    requestedStt: 'auto',
    requestedTts: 'piper',
    targetLang: 'pt-BR',
    selectedVoices: {
      piper: 'pt_BR-faber-medium',
      kokoro: 'pm_alex',
      f5: 'padrao',
      inworld: 'Heitor',
      elevenlabs: 'JBFqnCBsd6RMkjVDRZzb',
      deepgram: 'aura-2-thalia-en'
    },
    credentials: new Set(['deepgram', 'elevenlabs', 'inworld']),
    ...overrides
  };
}

const resolve = (overrides: Partial<EngineResolutionInput> = {}) =>
  resolveEngines(input(overrides), CAPABILITIES);

describe('EngineResolver', () => {
  describe('resolucao do preset', () => {
    it('preset deepgram transcreve com o Deepgram', () => {
      assert.equal(resolve({ preset: 'deepgram' }).sttProvider, 'deepgram');
    });

    it('preset google usa as legendas da Udemy', () => {
      assert.equal(resolve({ preset: 'google' }).sttProvider, 'captions');
    });

    it('tts auto segue o preset', () => {
      assert.equal(resolve({ preset: 'google', requestedTts: 'auto' }).ttsEngine, 'google');
    });

    it('escolha explicita vence o preset', () => {
      assert.equal(resolve({ preset: 'google', requestedTts: 'kokoro' }).ttsEngine, 'kokoro');
    });
  });

  describe('credenciais ausentes', () => {
    it('sem key do Deepgram a transcricao cai para as legendas', () => {
      const result = resolve({ credentials: new Set(['elevenlabs']) });
      assert.equal(result.sttProvider, 'captions');
      assert.ok(result.notes.some((note) => note.includes('Deepgram')));
    });

    it('sem key do ElevenLabs a voz cai para o Google', () => {
      const result = resolve({ requestedTts: 'elevenlabs', credentials: new Set(['deepgram']) });
      assert.equal(result.ttsEngine, 'google');
      assert.equal(result.voice, null);
    });

    it('sem key do Inworld a voz cai para o Google', () => {
      const result = resolve({ requestedTts: 'inworld', credentials: new Set() });
      assert.equal(result.ttsEngine, 'google');
    });

    it('motor local nao exige credencial nenhuma', () => {
      const result = resolve({ requestedTts: 'piper', credentials: new Set() });
      assert.equal(result.ttsEngine, 'piper');
    });
  });

  describe('idioma sem voz disponivel', () => {
    it('pt-BR no Deepgram cai para o Google TTS', () => {
      const result = resolve({ requestedTts: 'deepgram', targetLang: 'pt-BR' });
      assert.equal(result.ttsEngine, 'google');
      assert.ok(result.notes.some((note) => note.includes('nao tem voz em pt-BR')));
    });

    it('espanhol mantem o Deepgram e troca para uma voz es', () => {
      const result = resolve({ requestedTts: 'deepgram', targetLang: 'es' });
      assert.equal(result.ttsEngine, 'deepgram');
      assert.ok(result.voice?.endsWith('-es'), `voz inesperada: ${result.voice}`);
      assert.ok(result.notes.some((note) => note.includes('Voz ajustada')));
    });

    it('ingles mantem a voz ja escolhida, sem aviso', () => {
      const result = resolve({ requestedTts: 'deepgram', targetLang: 'en' });
      assert.equal(result.voice, 'aura-2-thalia-en');
      assert.deepEqual(result.notes, []);
    });
  });

  describe('avisos que nao trocam o motor', () => {
    it('voz do Piper em outro idioma vira aviso, nao troca', () => {
      const result = resolve({ requestedTts: 'piper', targetLang: 'es' });
      assert.equal(result.ttsEngine, 'piper');
      assert.equal(result.voice, 'pt_BR-faber-medium');
      assert.ok(result.notes.some((note) => note.includes('fala pt')));
    });

    it('voz pt do Kokoro com destino espanhol avisa', () => {
      const result = resolve({ requestedTts: 'kokoro', targetLang: 'es' });
      assert.equal(result.ttsEngine, 'kokoro');
      assert.ok(result.notes.length > 0);
    });

    it('Kokoro em pt-BR nao avisa nada', () => {
      assert.deepEqual(resolve({ requestedTts: 'kokoro', targetLang: 'pt-BR' }).notes, []);
    });

    it('F5 sem referencia escolhida avisa', () => {
      const result = resolve({ requestedTts: 'f5', selectedVoices: {} });
      assert.equal(result.ttsEngine, 'f5');
      assert.ok(result.notes.some((note) => note.includes('models/f5-ref')));
    });

    it('F5 com referencia propria usa o nome dela', () => {
      const result = resolve({ requestedTts: 'f5', selectedVoices: { f5: 'minhavoz' } });
      assert.equal(result.voice, 'minhavoz');
      assert.deepEqual(result.notes, []);
    });
  });

  it('Google TTS nunca carrega voz', () => {
    assert.equal(resolve({ requestedTts: 'google' }).voice, null);
  });

  it('e puro: chamar duas vezes da o mesmo resultado', () => {
    const shared = input();
    assert.deepEqual(resolveEngines(shared, CAPABILITIES), resolveEngines(shared, CAPABILITIES));
  });
});
