/** Idiomas oferecidos na interface. */

import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';

export interface LanguageOption {
  readonly code: LanguageTag;
  readonly label: string;
}

/** Idiomas de destino: todos suportados pelo TTS do Google, o motor de fallback. */
export const TARGET_LANGUAGES: readonly LanguageOption[] = [
  { code: 'pt-BR', label: 'Portugues (Brasil)' },
  { code: 'pt-PT', label: 'Portugues (Portugal)' },
  { code: 'es', label: 'Espanhol' },
  { code: 'en', label: 'Ingles' },
  { code: 'fr', label: 'Frances' },
  { code: 'de', label: 'Alemao' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: 'Japones' }
];

export const SOURCE_LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', label: 'Ingles' },
  { code: 'es', label: 'Espanhol' },
  { code: 'fr', label: 'Frances' },
  { code: 'de', label: 'Alemao' },
  { code: 'it', label: 'Italiano' },
  { code: 'auto', label: 'Detectar automaticamente' }
];

/** O endpoint de traducao do Google usa codigos ligeiramente diferentes. */
export function toTranslateCode(code: LanguageTag): string {
  const map: Record<string, string> = {
    'pt-BR': 'pt',
    pt: 'pt',
    'pt-PT': 'pt-PT',
    'en-US': 'en',
    'en-GB': 'en'
  };
  return map[code] ?? code;
}

/** Ja o de TTS quer a variante regional. */
export function toTtsCode(code: LanguageTag): string {
  const map: Record<string, string> = {
    'pt-BR': 'pt-BR',
    pt: 'pt-BR',
    'pt-PT': 'pt-PT'
  };
  return map[code] ?? code;
}
