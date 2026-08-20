/*
 * Texto original a partir das legendas.
 *
 * Duas fontes, nesta ordem: o arquivo VTT que a API da Udemy entrega, e as cues
 * que o proprio player ja carregou. A segunda so funciona se o usuario tiver
 * ligado as legendas no player pelo menos uma vez, mas salva o caso em que a
 * API da Udemy nao responde.
 *
 * O download do VTT tenta primeiro direto do service worker e, se o CORS
 * barrar, pede a aba que baixe usando os cookies dela.
 */

import type { CaptionTrack, Lecture } from '../../domain/entities/Lecture.ts';
import { baseLanguage, isAutoDetect } from '../../domain/value-objects/LanguageCode.ts';
import type { LanguageTag } from '../../domain/value-objects/LanguageCode.ts';
import { cuesToVtt, parseCaptions } from '../../domain/services/CaptionParser.ts';
import { groupCues } from '../../domain/services/SegmentGrouper.ts';
import type {
  TranscriptionPort,
  TranscriptionRequest,
  TranscriptionResult
} from '../../application/ports/TranscriptionPort.ts';
import type { LectureSourcePort } from '../../application/ports/LectureSourcePort.ts';

export class CaptionsSttAdapter implements TranscriptionPort {
  readonly id = 'captions' as const;
  readonly label = 'Lendo as legendas da aula';
  readonly #source: LectureSourcePort;

  constructor(source: LectureSourcePort) {
    this.#source = source;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult | null> {
    const caption = pickCaption(request.lecture, request.sourceLang);

    if (caption) {
      const vtt = await this.#fetchCaption(caption.url);
      const segments = groupCues(parseCaptions(vtt));
      if (segments.length > 0) {
        return {
          segments,
          origin: { kind: 'captions', locale: caption.locale || '?' },
          notes: []
        };
      }
    }

    if (request.lecture.localCues.length > 0) {
      const segments = groupCues(parseCaptions(cuesToVtt(request.lecture.localCues)));
      if (segments.length > 0) {
        return { segments, origin: { kind: 'player-cues' }, notes: [] };
      }
    }

    return null;
  }

  async #fetchCaption(url: string): Promise<string> {
    try {
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch {
      // CORS ou cookie obrigatorio: a aba consegue o que o worker nao consegue
      return this.#source.fetchText(url);
    }
  }
}

/**
 * Legenda no idioma de origem. Em modo automatico prefere ingles, que e o que a
 * esmagadora maioria dos cursos da Udemy oferece; se nada casar, usa a primeira
 * disponivel, porque traduzir de um idioma inesperado ainda e melhor do que
 * falhar.
 */
function pickCaption(lecture: Lecture, sourceLang: LanguageTag): CaptionTrack | null {
  const tracks = lecture.captions.filter((caption) => caption.url);
  if (tracks.length === 0) return null;

  const wanted = isAutoDetect(sourceLang) ? 'en' : baseLanguage(sourceLang);
  return (
    tracks.find((caption) => baseLanguage(caption.locale) === wanted) ??
    tracks.find((caption) => baseLanguage(caption.locale) === 'en') ??
    tracks[0]!
  );
}
