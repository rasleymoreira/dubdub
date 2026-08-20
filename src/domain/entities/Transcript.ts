/** Texto de origem de uma aula, com a procedencia registrada. */

import type { SourceSegment } from './Segment.ts';

/** De onde veio o texto: importa para o usuario saber por que a qualidade varia. */
export type TranscriptOrigin =
  | { readonly kind: 'deepgram'; readonly model: string }
  | { readonly kind: 'captions'; readonly locale: string }
  | { readonly kind: 'player-cues' };

export interface Transcript {
  readonly lectureId: string;
  readonly segments: readonly SourceSegment[];
  readonly origin: TranscriptOrigin;
  readonly createdAt: number;
}

export function describeOrigin(origin: TranscriptOrigin): string {
  switch (origin.kind) {
    case 'deepgram':
      return `deepgram:${origin.model}`;
    case 'captions':
      return `captions:${origin.locale}`;
    case 'player-cues':
      return 'captions:player';
  }
}
