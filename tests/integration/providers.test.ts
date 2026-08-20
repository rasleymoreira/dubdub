/**
 * Testes de integracao: batem em rede e nos servidores locais de verdade.
 *
 * NAO rodam por padrao, e essa e a diferenca mais importante em relacao a suite
 * anterior. Antes `npm test` chamava Google, Deepgram, ElevenLabs e Inworld a
 * cada execucao, usando chaves embutidas no codigo: lento, dependente da
 * internet, capaz de gastar credito e de falhar por motivo alheio ao commit.
 *
 * Aqui cada bloco pula sozinho quando falta a credencial ou o servidor nao esta
 * no ar, e a CI so executa a suite unitaria.
 *
 *   npm run test:integration
 *   DG_KEY=... EL_KEY=... IW_KEY=... npm run test:integration
 */

import assert from 'node:assert/strict';
import { describe, it, skip } from 'node:test';

import { NEVER_CANCELED } from '../../src/application/services/CancellationToken.ts';
import { GoogleTranslateAdapter } from '../../src/infrastructure/translation/GoogleTranslateAdapter.ts';
import { GoogleTtsAdapter } from '../../src/infrastructure/tts/GoogleTtsAdapter.ts';
import { DeepgramSttAdapter } from '../../src/infrastructure/stt/DeepgramSttAdapter.ts';
import { ElevenLabsTtsAdapter } from '../../src/infrastructure/tts/ElevenLabsTtsAdapter.ts';
import { InworldTtsAdapter } from '../../src/infrastructure/tts/InworldTtsAdapter.ts';
import { LocalHttpTtsAdapter } from '../../src/infrastructure/tts/LocalHttpTtsAdapter.ts';
import {
  LOCAL_SERVER_CATALOG,
  describeEngine
} from '../../src/infrastructure/catalog/engines.catalog.ts';
import { DEFAULT_SETTINGS } from '../../src/infrastructure/catalog/defaults.ts';
import type { LocalTtsEngineId } from '../../src/domain/value-objects/EngineId.ts';

const DG_KEY = process.env['DG_KEY'] ?? '';
const EL_KEY = process.env['EL_KEY'] ?? '';
const IW_KEY = process.env['IW_KEY'] ?? '';

const base = { targetLang: 'pt-BR', signal: NEVER_CANCELED } as const;

describe('Google Translate', () => {
  it('devolve uma traducao por trecho', async () => {
    const result = await new GoogleTranslateAdapter().translate({
      texts: ['Hello and welcome to this course.', "Let's get started!", 'The quick brown fox.'],
      from: 'en',
      to: 'pt-BR',
      signal: NEVER_CANCELED
    });

    assert.equal(result.length, 3);
    for (const text of result) assert.ok(text.length > 3, `traducao vazia: ${text}`);
  });
});

describe('Google TTS', () => {
  const adapter = new GoogleTtsAdapter();

  it('devolve audio de um trecho curto', async () => {
    const clip = await adapter.speak({ ...base, text: 'Ola, bem-vindo a esta aula.', voice: null });
    assert.equal(clip.parts.length, 1);
    assert.ok(clip.parts[0]!.length > 500);
  });

  it('divide texto longo em partes, por causa do limite do endpoint', async () => {
    const longo =
      'Este e um texto bem mais longo, com varias oracoes, para forcar a divisao do audio. ' +
      'Depois disso o player precisa tocar todas as partes em sequencia, sem buraco audivel. ' +
      'Se o trecho nao couber no tempo da fala original, a voz e acelerada ate o limite.';

    const clip = await adapter.speak({ ...base, text: longo, voice: null });
    assert.ok(clip.parts.length >= 2, `esperava varias partes, veio ${clip.parts.length}`);
  });
});

describe('Deepgram', { skip: DG_KEY ? false : 'sem DG_KEY' }, () => {
  const adapter = new DeepgramSttAdapter({ apiKey: () => DG_KEY, model: () => 'nova-3' });

  it('valida a credencial', async () => {
    const { projects } = await adapter.validateKey(DG_KEY);
    assert.ok(Array.isArray(projects));
  });

  it('transcreve com tempos crescentes', async () => {
    const result = await adapter.transcribe({
      lecture: {
        lectureId: 'teste',
        courseId: null,
        slug: '',
        title: '',
        url: '',
        captions: [],
        mediaSources: [{ src: 'https://dpgr.am/spacewalk.wav', type: 'audio/wav', label: '' }],
        localCues: [],
        duration: null,
        currentTime: 0,
        warnings: []
      },
      sourceLang: 'en',
      signal: NEVER_CANCELED
    });

    assert.ok(result);
    assert.ok(result.segments.length > 0, 'nenhum segmento transcrito');
    assert.ok(result.segments[0]!.end > result.segments[0]!.start);
  });
});

describe('ElevenLabs', { skip: EL_KEY ? false : 'sem EL_KEY' }, () => {
  const adapter = new ElevenLabsTtsAdapter({
    apiKey: () => EL_KEY,
    model: () => DEFAULT_SETTINGS.elevenModel,
    format: () => DEFAULT_SETTINGS.elevenFormat
  });

  it('le a quota da conta', async () => {
    const quota = await adapter.getQuota(EL_KEY);
    assert.ok(quota.limit >= 0);
    assert.equal(quota.remaining, Math.max(0, quota.limit - quota.used));
  });

  it('lista as vozes da conta', async () => {
    assert.ok((await adapter.listVoices(EL_KEY)).length > 0);
  });

  it('sintetiza, ou falha com mensagem legivel para a UI', async () => {
    try {
      const clip = await adapter.speak({
        ...base,
        text: 'ok',
        voice: DEFAULT_SETTINGS.elevenVoiceId
      });
      assert.equal(clip.mime, 'audio/mpeg');
    } catch (error) {
      // conta sem credito e resultado esperado; o que importa e a mensagem
      assert.match(String((error as Error).message), /ElevenLabs \d{3}: .+/);
    }
  });
});

describe('Inworld', { skip: IW_KEY ? false : 'sem IW_KEY' }, () => {
  const adapter = new InworldTtsAdapter({
    apiKey: () => IW_KEY,
    model: () => DEFAULT_SETTINGS.inworldModel,
    bitRate: () => DEFAULT_SETTINGS.inworldBitRate
  });

  it('lista vozes em portugues', async () => {
    const voices = await adapter.listVoices(IW_KEY, 'pt');
    assert.ok(voices.length > 0);
    assert.ok(voices.some((voice) => voice.id === 'Heitor'));
  });

  it('sintetiza mp3 tocavel', async () => {
    const clip = await adapter.speak({ ...base, text: 'Teste de voz.', voice: 'Heitor' });
    const bytes = Buffer.from(clip.parts[0]!, 'base64');
    assert.equal(clip.mime, 'audio/mpeg');
    // 0xFF inicia o frame header de um MP3
    assert.equal(bytes[0], 0xff);
    assert.ok(bytes.length > 1000);
  });
});

/**
 * Servidores locais: exercitam o contrato compartilhado dos tres motores.
 * Pulam quando o servidor nao esta no ar, que e o caso normal na CI.
 */
for (const engine of ['piper', 'kokoro', 'f5'] as LocalTtsEngineId[]) {
  const descriptor = LOCAL_SERVER_CATALOG[engine];
  const url =
    process.env[`${engine.toUpperCase()}_URL`] ?? `http://localhost:${descriptor.defaultPort}`;

  describe(`${descriptor.label} (servidor local)`, () => {
    const adapter = new LocalHttpTtsAdapter({
      engine,
      label: descriptor.label,
      concurrency: describeEngine(engine).concurrency,
      baseUrl: () => url,
      setupHint: descriptor.setupHint
    });

    it('responde no contrato esperado e sintetiza um trecho de aula', async (t) => {
      const info = await adapter.info(url);
      const voices = await adapter.listVoices(url);
      if (info === null && voices === null) {
        return skip(`nao esta no ar em ${url}`) as unknown as void;
      }

      const clip = await adapter.speak({
        ...base,
        text: 'Nesta aula vamos criar uma funcao remota que roda no servidor.',
        voice: descriptor.defaultVoice || null
      });

      const bytes = Buffer.from(clip.parts[0]!, 'base64');
      assert.ok(/audio/.test(clip.mime), `mime inesperado: ${clip.mime}`);
      assert.ok(bytes.length > 2000, `audio curto demais: ${bytes.length} bytes`);

      // WAV: confere que ha mais de um segundo de fala de verdade
      if (bytes.subarray(0, 4).toString('ascii') === 'RIFF') {
        const seconds = (bytes.length - 44) / (bytes.readUInt32LE(24) * 2);
        assert.ok(seconds > 1, `apenas ${seconds.toFixed(2)}s de audio`);
        t.diagnostic(
          `${descriptor.label}: ${seconds.toFixed(2)}s, ${(bytes.length / 1024).toFixed(0)} KB`
        );
      }
    });
  });
}
