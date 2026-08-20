/**
 * Chave de uma dublagem no cache.
 *
 * Antes era a string `"id|lang|engine|voice"` montada por uma funcao e lida por
 * split espalhado pelo codigo (Primitive Obsession). Como value object, a regra
 * "mesma aula + idioma + motor + voz = mesmo cache" fica declarada num lugar so,
 * e trocar a voz continua invalidando o cache sem ninguem precisar lembrar.
 */

import type { LanguageTag } from './LanguageCode.ts';
import type { TtsEngineId, VoiceId } from './EngineId.ts';

const SEPARATOR = '|';

export interface DubKeyParts {
  readonly lectureId: string;
  readonly targetLang: LanguageTag;
  readonly ttsEngine: TtsEngineId;
  readonly voice: VoiceId | null;
}

export class DubKey {
  private constructor(
    readonly lectureId: string,
    readonly targetLang: LanguageTag,
    readonly ttsEngine: TtsEngineId,
    readonly voice: VoiceId
  ) {}

  static from(parts: DubKeyParts): DubKey {
    // o Google TTS nao tem escolha de voz: normalizar evita duas chaves para a
    // mesma dublagem so porque um caminho passou null e o outro ''
    const voice = parts.ttsEngine === 'google' ? 'default' : parts.voice || 'default';
    return new DubKey(String(parts.lectureId), parts.targetLang, parts.ttsEngine, voice);
  }

  static parse(value: string): DubKey | null {
    const [lectureId, targetLang, ttsEngine, voice] = value.split(SEPARATOR);
    if (!lectureId || !targetLang || !ttsEngine || !voice) return null;
    return new DubKey(lectureId, targetLang, ttsEngine as TtsEngineId, voice);
  }

  toString(): string {
    return [this.lectureId, this.targetLang, this.ttsEngine, this.voice].join(SEPARATOR);
  }

  equals(other: DubKey): boolean {
    return this.toString() === other.toString();
  }
}

/** Chave da transcricao: independe do motor de voz, so da origem do texto. */
export class TranscriptKey {
  private constructor(
    readonly lectureId: string,
    readonly sttProvider: string,
    readonly sourceLang: LanguageTag
  ) {}

  static from(parts: {
    lectureId: string;
    sttProvider: string;
    sourceLang: LanguageTag;
  }): TranscriptKey {
    return new TranscriptKey(String(parts.lectureId), parts.sttProvider, parts.sourceLang);
  }

  toString(): string {
    return [this.lectureId, this.sttProvider, this.sourceLang].join(SEPARATOR);
  }
}
