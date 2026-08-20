/*
 * Leitura da pagina da Udemy.
 *
 * Este e o unico arquivo do projeto que conhece o HTML e a API interna da
 * Udemy, e isso e deliberado: e a parte que quebra quando a Udemy mexe no site.
 * Concentrada aqui, um redesenho la vira uma correcao neste arquivo em vez de
 * uma cacada por seletores espalhados.
 *
 * Roda no content script porque a API interna exige os cookies e o Referer da
 * propria pagina; do service worker as mesmas chamadas voltam 403.
 *
 * Toda extracao degrada em vez de falhar: API primeiro, DOM depois, e por fim o
 * que o player ja carregou.
 */

import type { CurriculumItem, Lecture } from '../../../domain/entities/Lecture.ts';
import type { LectureSourcePort } from '../../../application/ports/LectureSourcePort.ts';
import type { Logger } from '../../../application/ports/Logger.ts';

const LECTURE_URL = /\/course\/([^/]+)\/learn\/lecture\/(\d+)/;
const MAX_TITLE_LENGTH = 160;
const CURRICULUM_PAGE_LIMIT = 6;

export interface LectureIds {
  readonly slug: string;
  readonly lectureId: string;
}

export function parseLectureUrl(href: string): LectureIds | null {
  const match = LECTURE_URL.exec(href || location.href);
  return match ? { slug: match[1]!, lectureId: match[2]! } : null;
}

/** Video principal da pagina, ignorando previews e players escondidos. */
export function findVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;

  const area = (video: HTMLVideoElement): number => {
    const rect = video.getBoundingClientRect();
    return rect.width * rect.height;
  };

  const visible = videos.filter((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width > 120 && rect.height > 80;
  });

  const pool = visible.length > 0 ? visible : videos;
  return [...pool].sort((a, b) => area(b) - area(a))[0] ?? null;
}

export class UdemyPageAdapter implements LectureSourcePort {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  async getLectureContext(lectureId?: string): Promise<Lecture | null> {
    const ids = parseLectureUrl(location.href);
    const targetId = String(lectureId ?? ids?.lectureId ?? '');
    if (!targetId) return null;

    const isCurrent = !lectureId || targetId === ids?.lectureId;
    const video = isCurrent ? findVideo() : null;
    const courseId = this.#findCourseId();
    const warnings: string[] = [];

    let captions: Lecture['captions'] = [];
    let mediaSources: Lecture['mediaSources'] = [];
    let title = isCurrent ? this.#findTitle() : '';
    let duration = video?.duration ?? null;

    if (courseId) {
      try {
        const asset = await this.#fetchLectureAsset(courseId, targetId);
        captions = normalizeCaptions(asset.asset);
        mediaSources = normalizeMediaSources(asset.asset);
        if (asset.title) title = asset.title;
        if (asset.asset?.length) duration = asset.asset.length;
      } catch (error) {
        warnings.push(`Nao consegui ler a API da Udemy: ${describe(error)}`);
      }
    } else {
      warnings.push('Nao encontrei o id do curso na pagina.');
    }

    return {
      lectureId: targetId,
      courseId,
      slug: ids?.slug ?? '',
      title,
      url: isCurrent ? location.href : '',
      captions,
      mediaSources,
      // ultimo recurso, e so faz sentido para a aula aberta
      localCues: captions.length === 0 && isCurrent ? this.#readPlayerCues() : [],
      duration,
      currentTime: video?.currentTime ?? 0,
      warnings
    };
  }

  async getCurriculum(): Promise<CurriculumItem[]> {
    const courseId = this.#findCourseId();

    if (courseId) {
      try {
        const items = await this.#curriculumFromApi(courseId);
        if (items.length > 0) return items;
      } catch (error) {
        this.#logger.warn('curriculo pela API falhou, lendo do menu lateral', error);
      }
    }

    return this.#curriculumFromDom();
  }

  /** Baixa usando os cookies da aba: o service worker nao tem essa permissao. */
  async fetchText(url: string): Promise<string> {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  // ------------------------------------------------------------- extracao

  /**
   * O courseId aparece em lugares diferentes conforme a versao do markup, entao
   * tentamos varios em ordem de confiabilidade e caimos ate a busca no HTML cru.
   */
  #findCourseId(): string | null {
    const attribute = document.querySelector('[data-clp-course-id]');
    const value = attribute?.getAttribute('data-clp-course-id');
    if (value && /^\d+$/.test(value)) return value;

    for (const node of document.querySelectorAll('[data-module-args]')) {
      try {
        const args = JSON.parse(node.getAttribute('data-module-args') ?? '') as {
          courseId?: number | string;
          course_id?: number | string;
          course?: { id?: number | string };
        };
        const id = args.courseId ?? args.course_id ?? args.course?.id;
        if (id) return String(id);
      } catch {
        /* o atributo nem sempre e JSON */
      }
    }

    // requisicoes que a propria SPA da Udemy ja fez carregam o id na URL
    try {
      for (const entry of performance.getEntriesByType('resource')) {
        const match = /subscribed-courses\/(\d+)\//.exec(entry.name);
        if (match) return match[1]!;
      }
    } catch {
      /* performance indisponivel */
    }

    const html = document.documentElement.innerHTML;
    const patterns = [
      /"courseId"\s*:\s*"?(\d+)/,
      /"course_id"\s*:\s*"?(\d+)/,
      /data-course-id="(\d+)"/
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match) return match[1]!;
    }

    return null;
  }

  #findTitle(): string {
    const selectors = [
      '[data-purpose="curriculum-item-title"][aria-current="true"]',
      '.curriculum-item-link--is-current--2mKk4 [data-purpose="item-title"]',
      '[data-purpose="lecture-title"]',
      'h1'
    ];

    for (const selector of selectors) {
      const text = document.querySelector(selector)?.textContent?.trim();
      if (text) return text.slice(0, MAX_TITLE_LENGTH);
    }

    return document.title.replace(/\s*\|\s*Udemy.*$/i, '').trim();
  }

  async #fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error(`API da Udemy respondeu ${response.status}`);
    return (await response.json()) as T;
  }

  async #fetchLectureAsset(courseId: string, lectureId: string): Promise<UdemyLectureResponse> {
    const params = new URLSearchParams({
      'fields[lecture]': 'title,asset,object_index',
      'fields[asset]': 'media_sources,captions,title,length,asset_type'
    });
    const url = `${location.origin}/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?${params.toString()}`;
    return this.#fetchJson<UdemyLectureResponse>(url);
  }

  /** Aulas na ordem do menu lateral, direto da API do curriculo. */
  async #curriculumFromApi(courseId: string): Promise<CurriculumItem[]> {
    const params = new URLSearchParams({
      page_size: '200',
      'fields[lecture]': 'id,title,object_index,asset',
      'fields[chapter]': 'id,title,object_index',
      'fields[quiz]': 'id,title',
      'fields[practice]': 'id,title',
      'fields[asset]': 'asset_type'
    });

    const items: CurriculumItem[] = [];
    let url: string | null =
      `${location.origin}/api-2.0/courses/${courseId}/subscriber-curriculum-items/?${params.toString()}`;
    let section = '';

    for (let page = 0; page < CURRICULUM_PAGE_LIMIT && url; page++) {
      const data: UdemyCurriculumResponse = await this.#fetchJson<UdemyCurriculumResponse>(url);

      for (const item of data.results ?? []) {
        if (item._class === 'chapter') {
          section = item.title ?? '';
          continue;
        }
        if (item._class !== 'lecture') continue;
        // quiz e exercicio nao tem audio para dublar
        if (item.asset?.asset_type && item.asset.asset_type !== 'Video') continue;

        items.push({ lectureId: String(item.id), title: item.title ?? '', section });
      }

      url = data.next ?? null;
    }

    return items;
  }

  /** Plano B: le os links de aula do menu lateral que estiver aberto. */
  #curriculumFromDom(): CurriculumItem[] {
    const items: CurriculumItem[] = [];
    const seen = new Set<string>();

    for (const anchor of document.querySelectorAll('a[href*="/learn/lecture/"]')) {
      const match = /\/learn\/lecture\/(\d+)/.exec(anchor.getAttribute('href') ?? '');
      if (!match || seen.has(match[1]!)) continue;
      seen.add(match[1]!);

      const titleNode = anchor.querySelector('[data-purpose="item-title"]');
      const panel = anchor.closest('[class*="accordion-panel"]');

      items.push({
        lectureId: match[1]!,
        title: (titleNode?.textContent ?? anchor.textContent ?? '')
          .trim()
          .slice(0, MAX_TITLE_LENGTH),
        section: (panel?.querySelector('.ud-accordion-panel-title')?.textContent ?? '').trim()
      });
    }

    return items;
  }

  /**
   * Cues que o proprio player carregou. So funciona se as legendas tiverem sido
   * ligadas no player pelo menos uma vez, mas salva o caso em que a API falha.
   */
  #readPlayerCues(): Lecture['localCues'] {
    const video = findVideo();
    if (!video?.textTracks?.length) return [];

    for (const track of Array.from(video.textTracks)) {
      if (track.language && !/^en/i.test(track.language)) continue;
      // sem passar para hidden as cues nao sao populadas
      if (track.mode === 'disabled') track.mode = 'hidden';

      const cues = Array.from(track.cues ?? [])
        .map((cue) => ({
          start: cue.startTime,
          end: cue.endTime,
          text: String((cue as VTTCue).text ?? '').trim()
        }))
        .filter((cue) => cue.text);

      if (cues.length > 0) return cues;
    }

    return [];
  }
}

// ------------------------------------------------------- formas da API Udemy

interface UdemyAsset {
  captions?: {
    url?: string;
    locale_id?: string;
    locale?: { locale?: string };
    video_label?: string;
    title?: string;
  }[];
  media_sources?: { src?: string; type?: string; label?: string }[];
  length?: number;
}

interface UdemyLectureResponse {
  title?: string;
  asset?: UdemyAsset;
}

interface UdemyCurriculumResponse {
  results?: {
    _class?: string;
    id?: number | string;
    title?: string;
    asset?: { asset_type?: string };
  }[];
  next?: string | null;
}

function normalizeCaptions(asset: UdemyAsset | undefined): Lecture['captions'] {
  return (asset?.captions ?? [])
    .filter((caption) => caption.url)
    .map((caption) => ({
      url: caption.url!,
      locale: caption.locale_id ?? caption.locale?.locale ?? caption.video_label ?? '',
      label: caption.video_label ?? caption.title ?? caption.locale_id ?? ''
    }));
}

function normalizeMediaSources(asset: UdemyAsset | undefined): Lecture['mediaSources'] {
  return (asset?.media_sources ?? [])
    .filter((media) => media.src)
    .map((media) => ({ src: media.src!, type: media.type ?? '', label: media.label ?? '' }));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
