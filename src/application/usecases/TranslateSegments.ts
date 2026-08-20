/**
 * Traduz os trechos, aproveitando o que ja esta em cache.
 *
 * O cache e por texto, nao por aula: cursos repetem frases (introducoes, avisos)
 * e a mesma aula redublada em outra voz nao paga traducao de novo.
 */

import { JobStatus } from '../../domain/entities/JobStatus.ts';
import type { SourceSegment } from '../../domain/entities/Segment.ts';
import { hashText } from '../../domain/value-objects/TextHash.ts';
import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import type { TranslationPort } from '../ports/TranslationPort.ts';
import type { TranslationRepository } from '../ports/repositories.ts';
import type { ProgressReporter } from '../ports/ProgressReporter.ts';
import type { CancellationSignal } from '../services/CancellationToken.ts';

export interface TranslateSegmentsInput {
  readonly segments: readonly SourceSegment[];
  readonly from: LanguageTag;
  readonly to: LanguageTag;
  readonly signal: CancellationSignal;
}

export interface TranslateSegmentsDeps {
  readonly translator: TranslationPort;
  readonly cache: TranslationRepository;
  readonly reporter: ProgressReporter;
}

const cacheKey = (targetLang: LanguageTag, text: string): string =>
  `${targetLang}|${hashText(text)}`;

export class TranslateSegments {
  private readonly deps: TranslateSegmentsDeps;

  constructor(deps: TranslateSegmentsDeps) {
    this.deps = deps;
  }

  async execute(input: TranslateSegmentsInput): Promise<string[]> {
    const keys = input.segments.map((segment) => cacheKey(input.to, segment.text));
    const cached = await this.deps.cache.findMany(keys);

    const translations: (string | null)[] = [...cached];
    const pending = translations
      .map((value, index) => (value ? -1 : index))
      .filter((index) => index >= 0);

    if (pending.length === 0) {
      return translations.map((text, index) => text ?? input.segments[index]!.text);
    }

    this.deps.reporter.report({
      status: JobStatus.TRANSLATING,
      done: 0,
      total: pending.length,
      message: `Traduzindo ${pending.length} trechos`
    });

    const fresh = await this.deps.translator.translate({
      texts: pending.map((index) => input.segments[index]!.text),
      from: input.from,
      to: input.to,
      signal: input.signal,
      onProgress: (done, total) =>
        this.deps.reporter.report({
          status: JobStatus.TRANSLATING,
          done,
          total,
          message: 'Traduzindo trechos'
        })
    });

    const toStore: { key: string; text: string }[] = [];
    pending.forEach((segmentIndex, position) => {
      // sem traducao, o texto original e melhor do que trecho vazio
      const text = fresh[position] || input.segments[segmentIndex]!.text;
      translations[segmentIndex] = text;
      toStore.push({ key: keys[segmentIndex]!, text });
    });

    await this.deps.cache.saveMany(toStore);

    return translations.map((text, index) => text ?? input.segments[index]!.text);
  }
}
