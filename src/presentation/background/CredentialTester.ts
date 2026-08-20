/*
 * Botoes Testar do popup.
 *
 * Substitui as quatro mensagens que existiam (VALIDATE_KEY, ELEVEN_TEST,
 * INWORLD_TEST, LOCAL_TEST). A diferenca entre elas era so qual provedor
 * chamar, e isso ja esta no catalogo: uma mensagem com o motor como
 * discriminador cobre todos e cobre os proximos.
 *
 * Nunca lanca: uma credencial invalida e resposta esperada de um botao de
 * teste, nao erro de sistema. O popup recebe ok:false com a mensagem.
 */

import { baseLanguage } from '../../domain/value-objects/LanguageCode.ts';
import type { TtsEngineId } from '../../domain/value-objects/EngineId.ts';
import { isLocalTtsEngineId } from '../../domain/value-objects/EngineId.ts';
import type { CredentialTestResult } from '../../application/ports/CredentialTestPort.ts';
import type { Settings } from '../../application/dto/Settings.ts';
import { LOCAL_SETTING_KEYS } from '../../infrastructure/catalog/engines.catalog.ts';
import { deepgramStt, elevenLabsTts, inworldTts, localAdapters } from './container.ts';

export type TestTarget = TtsEngineId | 'deepgram-stt';

export interface CredentialTestInput {
  readonly engine: TestTarget;
  readonly apiKey?: string | undefined;
  readonly url?: string | undefined;
  readonly voice?: string | undefined;
}

export async function testCredential(
  input: CredentialTestInput,
  settings: Settings
): Promise<CredentialTestResult> {
  try {
    if (isLocalTtsEngineId(input.engine)) {
      return await testLocalServer(input, settings);
    }

    switch (input.engine) {
      case 'deepgram':
      case 'deepgram-stt': {
        const key = input.apiKey || settings.deepgramApiKey;
        const { projects } = await deepgramStt.validateKey(key);
        return { ok: true, projects };
      }

      case 'elevenlabs': {
        const key = input.apiKey || settings.elevenApiKey;
        const [quota, voices] = await Promise.all([
          elevenLabsTts.getQuota(key),
          elevenLabsTts.listVoices(key)
        ]);
        return { ok: true, quota, voices };
      }

      case 'inworld': {
        const key = input.apiKey || settings.inworldApiKey;
        const voices = await inworldTts.listVoices(key, baseLanguage(settings.targetLang));
        return { ok: true, voices };
      }

      case 'google':
        // sem credencial e sem servidor: nao ha o que testar
        return { ok: true };

      default:
        return { ok: false, error: `motor sem teste disponivel: ${String(input.engine)}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function testLocalServer(
  input: CredentialTestInput,
  settings: Settings
): Promise<CredentialTestResult> {
  const engine = input.engine as keyof typeof localAdapters;
  const adapter = localAdapters[engine];
  const keys = LOCAL_SETTING_KEYS[engine];

  const url = input.url || String(settings[keys.url as keyof Settings]);
  const voice = input.voice || String(settings[keys.voice as keyof Settings]);

  const [voices, info] = await Promise.all([adapter.listVoices(url), adapter.info(url)]);

  // a sintese minima confirma que o servidor nao so responde, mas gera audio
  await adapter.preflight({
    voice,
    targetLang: settings.targetLang,
    estimatedChars: 0
  });

  return {
    ok: true,
    device: info?.device ?? null,
    voices: (voices ?? []).map((id) => ({ id, name: id }))
  };
}
