/*
 * Leitura do contexto da aula direto da pagina da Udemy: ids, legendas e as
 * URLs de midia. Roda no content script porque a API interna da Udemy exige os
 * cookies e o Referer da propria pagina.
 */

var UDUB_Udemy = (function () {
  'use strict';

  const LECTURE_URL = /\/course\/([^/]+)\/learn\/lecture\/(\d+)/;

  function parseUrl(href) {
    const match = LECTURE_URL.exec(href || location.href);
    if (!match) return null;
    return { slug: match[1], lectureId: match[2] };
  }

  /** Procura o courseId em varios lugares porque a Udemy muda o markup. */
  function findCourseId() {
    const attr = document.querySelector('[data-clp-course-id]');
    if (attr) {
      const value = attr.getAttribute('data-clp-course-id');
      if (/^\d+$/.test(value || '')) return value;
    }

    for (const node of document.querySelectorAll('[data-module-args]')) {
      try {
        const args = JSON.parse(node.getAttribute('data-module-args'));
        const id = args?.courseId || args?.course_id || args?.course?.id;
        if (id) return String(id);
      } catch {
        /* nao era JSON */
      }
    }

    // requisicoes que a propria SPA da Udemy ja fez
    try {
      for (const entry of performance.getEntriesByType('resource')) {
        const match = /subscribed-courses\/(\d+)\//.exec(entry.name);
        if (match) return match[1];
      }
    } catch {
      /* performance indisponivel */
    }

    const html = document.documentElement.innerHTML;
    const patterns = [/"courseId"\s*:\s*"?(\d+)/, /"course_id"\s*:\s*"?(\d+)/, /data-course-id="(\d+)"/];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match) return match[1];
    }
    return null;
  }

  function findTitle() {
    const selectors = [
      '[data-purpose="curriculum-item-title"][aria-current="true"]',
      '.curriculum-item-link--is-current--2mKk4 [data-purpose="item-title"]',
      '[data-purpose="lecture-title"]',
      'h1'
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = node?.textContent?.trim();
      if (text) return text.slice(0, 160);
    }
    return document.title.replace(/\s*\|\s*Udemy.*$/i, '').trim();
  }

  /** Video principal da pagina (ignora previews e players escondidos). */
  function findVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;
    const visible = videos.filter((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 120 && rect.height > 80;
    });
    const pool = visible.length ? visible : videos;
    return pool.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0];
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error('API da Udemy respondeu ' + response.status);
    return response.json();
  }

  /** Aulas do curso na ordem do menu lateral, direto da API do curriculo. */
  async function curriculumFromApi(courseId) {
    const params = new URLSearchParams({
      page_size: '200',
      'fields[lecture]': 'id,title,object_index,asset',
      'fields[chapter]': 'id,title,object_index',
      'fields[quiz]': 'id,title',
      'fields[practice]': 'id,title',
      'fields[asset]': 'asset_type'
    });

    const items = [];
    let url = location.origin + '/api-2.0/courses/' + courseId + '/subscriber-curriculum-items/?' + params.toString();
    let section = '';

    for (let page = 0; page < 6 && url; page++) {
      const data = await fetchJson(url);
      for (const item of data?.results || []) {
        if (item._class === 'chapter') {
          section = item.title || '';
          continue;
        }
        if (item._class !== 'lecture') continue;
        if (item.asset && item.asset.asset_type && item.asset.asset_type !== 'Video') continue;
        items.push({ lectureId: String(item.id), title: item.title || '', section });
      }
      url = data?.next || null;
    }
    return items;
  }

  /** Plano B: le os links de aula do menu lateral que estiver aberto. */
  function curriculumFromDom() {
    const items = [];
    for (const anchor of document.querySelectorAll('a[href*="/learn/lecture/"]')) {
      const match = /\/learn\/lecture\/(\d+)/.exec(anchor.getAttribute('href') || '');
      if (!match) continue;
      if (items.some((item) => item.lectureId === match[1])) continue;

      const titleNode = anchor.querySelector('[data-purpose="item-title"]');
      const panel = anchor.closest('[class*="accordion-panel"]');
      items.push({
        lectureId: match[1],
        title: (titleNode?.textContent || anchor.textContent || '').trim().slice(0, 160),
        section: (panel?.querySelector('.ud-accordion-panel-title')?.textContent || '').trim()
      });
    }
    return items;
  }

  async function getCurriculum() {
    const courseId = findCourseId();
    if (courseId) {
      try {
        const items = await curriculumFromApi(courseId);
        if (items.length) return { courseId, items, source: 'api' };
      } catch {
        /* cai para o DOM */
      }
    }
    return { courseId, items: curriculumFromDom(), source: 'dom' };
  }

  async function fetchLectureAsset(courseId, lectureId) {
    const params = new URLSearchParams({
      'fields[lecture]': 'title,asset,object_index',
      'fields[asset]': 'media_sources,captions,title,length,asset_type'
    });
    const url =
      location.origin +
      '/api-2.0/users/me/subscribed-courses/' +
      courseId +
      '/lectures/' +
      lectureId +
      '/?' +
      params.toString();

    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error('API da Udemy respondeu ' + response.status);
    return response.json();
  }

  function normalizeCaptions(asset) {
    const list = Array.isArray(asset?.captions) ? asset.captions : [];
    return list
      .filter((caption) => caption && caption.url)
      .map((caption) => ({
        url: caption.url,
        locale: caption.locale_id || caption.locale?.locale || caption.video_label || '',
        label: caption.video_label || caption.title || caption.locale_id || '',
        source: caption.source || ''
      }));
  }

  function normalizeMediaSources(asset) {
    const list = Array.isArray(asset?.media_sources) ? asset.media_sources : [];
    return list
      .filter((media) => media && media.src)
      .map((media) => ({ src: media.src, type: media.type || '', label: media.label || '' }));
  }

  /**
   * Ultimo recurso: le as cues que o proprio player carregou. Precisa que as
   * legendas tenham sido ativadas no player pelo menos uma vez.
   */
  function readPlayerCues() {
    const video = findVideo();
    if (!video?.textTracks?.length) return [];
    const cues = [];
    for (const track of Array.from(video.textTracks)) {
      if (!/^en/i.test(track.language || '') && track.language) continue;
      if (track.mode === 'disabled') track.mode = 'hidden';
      for (const cue of Array.from(track.cues || [])) {
        const text = String(cue.text || '').trim();
        if (text) cues.push({ start: cue.startTime, end: cue.endTime, text });
      }
      if (cues.length) break;
    }
    return cues;
  }

  /**
   * Contexto completo de uma aula, com degradacao graciosa por etapa. Sem
   * argumento le a aula aberta; com `targetLectureId` le outra aula do curso
   * (usado para dublar as proximas com antecedencia).
   */
  async function getLectureContext(targetLectureId) {
    const ids = parseUrl(location.href);
    const lectureId = String(targetLectureId || ids?.lectureId || '');
    if (!lectureId) return null;
    const isCurrent = !targetLectureId || lectureId === ids?.lectureId;
    const video = isCurrent ? findVideo() : null;

    const context = {
      lectureId,
      slug: ids?.slug || '',
      courseId: findCourseId(),
      title: isCurrent ? findTitle() : '',
      url: isCurrent ? location.href : '',
      captions: [],
      mediaSources: [],
      localCues: [],
      duration: video?.duration || null,
      currentTime: video?.currentTime || 0,
      warnings: []
    };

    if (context.courseId) {
      try {
        const data = await fetchLectureAsset(context.courseId, context.lectureId);
        const asset = data?.asset || {};
        context.captions = normalizeCaptions(asset);
        context.mediaSources = normalizeMediaSources(asset);
        if (data?.title) context.title = data.title;
        if (asset.length) context.duration = asset.length;
      } catch (error) {
        context.warnings.push('Nao consegui ler a API da Udemy: ' + error.message);
      }
    } else {
      context.warnings.push('Nao encontrei o id do curso na pagina.');
    }

    if (!context.captions.length && isCurrent) context.localCues = readPlayerCues();
    return context;
  }

  return { parseUrl, getLectureContext, getCurriculum, findVideo, readPlayerCues };
})();
