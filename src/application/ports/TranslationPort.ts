/** Porta de traducao de texto. */

import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import type { CancellationSignal } from '../services/CancellationToken.ts';

export interface TranslationRequest {
  readonly texts: readonly string[];
  readonly from: LanguageTag;
  readonly to: LanguageTag;
  readonly signal: CancellationSignal;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface TranslationPort {
  /** Devolve uma traducao por texto, preservando os indices. */
  translate(request: TranslationRequest): Promise<string[]>;
}
