/** Contexto de uma aula, extraido da pagina da Udemy. */

export interface CaptionTrack {
  readonly url: string;
  readonly locale: string;
  readonly label: string;
}

export interface MediaSource {
  readonly src: string;
  readonly type: string;
  readonly label: string;
}

export interface CaptionCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface Lecture {
  readonly lectureId: string;
  readonly courseId: string | null;
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly captions: readonly CaptionTrack[];
  readonly mediaSources: readonly MediaSource[];
  /** Cues lidas do proprio player, ultimo recurso quando a API nao responde. */
  readonly localCues: readonly CaptionCue[];
  readonly duration: number | null;
  readonly currentTime: number;
  readonly warnings: readonly string[];
}

/** Item do curriculo do curso, usado para adiantar as proximas aulas. */
export interface CurriculumItem {
  readonly lectureId: string;
  readonly title: string;
  readonly section: string;
}

export function hasUsableSource(lecture: Lecture): boolean {
  return (
    lecture.captions.length > 0 || lecture.mediaSources.length > 0 || lecture.localCues.length > 0
  );
}
