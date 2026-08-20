/**
 * Codigo de idioma BCP-47 reduzido ao que o projeto usa ('pt-BR', 'en', 'es').
 *
 * Antes isso era string crua com `baseLang()` chamado em sete lugares diferentes
 * para comparar idiomas. Como value object a comparacao fica num lugar so.
 */

export type LanguageTag = string;

/** 'pt-BR' -> 'pt'. Usado para casar idioma de destino com voz do provedor. */
export function baseLanguage(code: LanguageTag | null | undefined): string {
  return String(code ?? '')
    .split('-')[0]!
    .toLowerCase();
}

/** Dois codigos falam a mesma lingua? ('pt-BR' e 'pt-PT' -> sim). */
export function sameLanguage(a: LanguageTag, b: LanguageTag): boolean {
  return baseLanguage(a) === baseLanguage(b);
}

/** 'auto' significa deixar o provedor detectar. */
export function isAutoDetect(code: LanguageTag): boolean {
  return code === 'auto';
}
