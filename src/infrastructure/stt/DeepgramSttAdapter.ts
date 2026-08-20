/*
 * Transcricao com o Deepgram (nova-3).
 *
 * Mandamos a URL da midia e o Deepgram baixa por conta dele, entao o video nao
 * trafega pela maquina do usuario. Escolhemos a menor resolucao disponivel: o
 * audio e o mesmo em todas e o Deepgram baixa menos bytes.
 *
 * Cursos com DRM nao expoem mp4. Nesse caso devolvemos null com um aviso, o que
 * faz o caso de uso seguir para a proxima fonte (as legendas da Udemy).
 */

import type { Lecture, MediaSource } from '../../domain/entities/Lecture.ts';
import type { SourceSegment } from '../../domain/entities/Segment.ts';
import { isAutoDetect } from '../../domain/value-objects/LanguageCode.ts';
import { groupCues } from '../../domain/services/SegmentGrouper.ts';
import { cleanCueText } from '../../domain/services/CaptionParser.ts';
import type {
  TranscriptionPort,
  TranscriptionRequest,
  TranscriptionResult
} from '../../application/ports/TranscriptionPort.ts';
import type { RemoteVoice } from '../../application/ports/CredentialTestPort.ts';
import { HttpClient } from '../http/HttpClient.ts';
import { withRetry } from '../http/retry.ts';

const API = 'https://api.deepgram.com/v1';

export interface DeepgramSttConfig {
  readonly apiKey: () => string;
  readonly model: () => string;
}

export class DeepgramSttAdapter implements TranscriptionPort {
  readonly id = 'deepgram' as const;
  readonly label = 'Transcrevendo o audio com o Deepgram';
  readonly #config: DeepgramSttConfig;
  readonly #http = new HttpClient('Deepgram');

  constructor(config: DeepgramSttConfig) {
    this.#config = config;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult | null> {
    const media = pickSmallestMp4(request.lecture);
    if (!media) {
      return {
        segments: [],
        origin: { kind: 'player-cues' },
        notes: ['Video sem arquivo mp4 acessivel (DRM): usando as legendas da Udemy.']
      };
    }

    const model = this.#config.model() || 'nova-3';
    const params = new URLSearchParams({
      model,
      smart_format: 'true',
      punctuate: 'true',
      utterances: 'true',
      utt_split: '0.8',
      filler_words: 'false'
    });

    if (isAutoDetect(request.sourceLang) || !request.sourceLang) {
      params.set('detect_language', 'true');
    } else {
      params.set('language', request.sourceLang);
    }

    const result = await withRetry(
      async () => {
        request.signal.throwIfCanceled();
        const response = await this.#http.send({
          url: `${API}/listen?${params.toString()}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Token ${this.#config.apiKey()}`
          },
          body: JSON.stringify({ url: media.src }),
          signal: request.signal
        });
        if (!response.ok) throw await this.#http.readError(response);
        return (await response.json()) as DeepgramResponse;
      },
      { tries: 2, baseDelayMs: 1500 }
    );

    return {
      segments: segmentsFrom(result),
      origin: { kind: 'deepgram', model },
      notes: []
    };
  }

  async validateKey(apiKey: string): Promise<{ projects: string[] }> {
    const response = await this.#http.expectOk(
      await this.#http.send({
        url: `${API}/projects`,
        headers: { Authorization: `Token ${apiKey}` }
      })
    );
    const data = (await response.json()) as { projects?: { name?: string }[] };
    return {
      projects: (data.projects ?? []).map((project) => project.name ?? '').filter(Boolean)
    };
  }
}

interface DeepgramResponse {
  results?: {
    utterances?: { start?: number; end?: number; transcript?: string }[];
    channels?: {
      alternatives?: {
        paragraphs?: {
          paragraphs?: { sentences?: { start: number; end: number; text: string }[] }[];
        };
      }[];
    }[];
  };
}

/**
 * Utterances ja vem no tamanho de frase. Se o modelo nao devolveu utterances,
 * caimos para as sentencas do smart_format, que sao mais curtas.
 */
function segmentsFrom(result: DeepgramResponse): SourceSegment[] {
  const utterances = result.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    return groupCues(
      utterances
        .map((utterance) => ({
          start: Number(utterance.start) || 0,
          end: Number(utterance.end) || 0,
          text: cleanCueText(utterance.transcript ?? '')
        }))
        .filter((cue) => cue.text && cue.end > cue.start)
    );
  }

  const paragraphs = result.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.paragraphs;
  if (Array.isArray(paragraphs) && paragraphs.length > 0) {
    const cues = paragraphs.flatMap((paragraph) =>
      (paragraph.sentences ?? [])
        .map((sentence) => ({
          start: sentence.start,
          end: sentence.end,
          text: cleanCueText(sentence.text ?? '')
        }))
        .filter((cue) => cue.text)
    );
    return groupCues(cues);
  }

  return [];
}

/** Menor mp4 disponivel: o audio e identico e o download e menor. */
function pickSmallestMp4(lecture: Lecture): MediaSource | null {
  const candidates = lecture.mediaSources.filter(
    (media) => media.src && /mp4/i.test(media.type || media.src)
  );
  if (candidates.length === 0) return null;

  const resolution = (media: MediaSource): number =>
    Number(String(media.label ?? '').replace(/\D/g, '')) || 9999;

  return [...candidates].sort((a, b) => resolution(a) - resolution(b))[0]!;
}

export type { RemoteVoice };
