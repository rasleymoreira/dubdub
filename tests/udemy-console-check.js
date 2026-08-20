/*
 * Diagnostico da pagina da Udemy.
 *
 * Cole este arquivo inteiro no console do DevTools (F12) com uma aula aberta,
 * por exemplo:
 *   https://www.udemy.com/course/ue5-multiplayer-crash-course/learn/lecture/51219311
 *
 * Ele mostra exatamente o que a extensao consegue extrair: id do curso,
 * legendas, arquivos de midia (para o Deepgram) e a lista de aulas usada para
 * adiantar as proximas. Nao depende da extensao estar instalada.
 */

(async () => {
  const out = (label, value) => console.log('%c' + label, 'color:#a435f0;font-weight:600', value);

  const ids = /\/course\/([^/]+)\/learn\/lecture\/(\d+)/.exec(location.href);
  if (!ids) return console.warn('Abra uma aula (.../learn/lecture/...) antes de rodar.');
  out('aula', { slug: ids[1], lectureId: ids[2] });

  // --- id do curso: as mesmas heuristicas da extensao, em ordem
  const strategies = {
    'data-clp-course-id': () => document.querySelector('[data-clp-course-id]')?.getAttribute('data-clp-course-id'),
    'data-module-args': () => {
      for (const node of document.querySelectorAll('[data-module-args]')) {
        try {
          const args = JSON.parse(node.getAttribute('data-module-args'));
          const id = args?.courseId || args?.course_id || args?.course?.id;
          if (id) return String(id);
        } catch {}
      }
      return null;
    },
    'performance entries': () => {
      for (const entry of performance.getEntriesByType('resource')) {
        const m = /subscribed-courses\/(\d+)\//.exec(entry.name);
        if (m) return m[1];
      }
      return null;
    },
    'regex no html': () => {
      const html = document.documentElement.innerHTML;
      for (const p of [/"courseId"\s*:\s*"?(\d+)/, /"course_id"\s*:\s*"?(\d+)/, /data-course-id="(\d+)"/]) {
        const m = p.exec(html);
        if (m) return m[1];
      }
      return null;
    }
  };
  const found = {};
  for (const [name, fn] of Object.entries(strategies)) found[name] = fn();
  out('courseId por estrategia', found);
  const courseId = Object.values(found).find(Boolean);
  if (!courseId) return console.error('Nenhuma estrategia achou o courseId — me avise para eu adicionar outra.');

  const api = (url) =>
    fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));

  // --- legendas e midia da aula atual
  try {
    const params = new URLSearchParams({
      'fields[lecture]': 'title,asset,object_index',
      'fields[asset]': 'media_sources,captions,title,length,asset_type'
    });
    const data = await api(
      `${location.origin}/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${ids[2]}/?${params}`
    );
    const asset = data.asset || {};
    out('titulo', data.title);
    out('tipo do asset', asset.asset_type);
    out(
      'legendas',
      (asset.captions || []).map((c) => ({ locale: c.locale_id || c.locale?.locale, label: c.video_label, url: !!c.url }))
    );
    out(
      'media_sources (Deepgram precisa de mp4)',
      (asset.media_sources || []).map((m) => ({ type: m.type, label: m.label }))
    );
    if (!(asset.media_sources || []).some((m) => /mp4/i.test(m.type || ''))) {
      console.warn('Sem mp4: curso com DRM. A transcricao vai usar as legendas.');
    }
    if (!(asset.captions || []).length) {
      console.warn('Sem legendas nesta aula.');
    }
  } catch (error) {
    console.error('Falha na API da aula:', error.message);
  }

  // --- lista de aulas (usada para adiantar as proximas)
  try {
    const params = new URLSearchParams({
      page_size: '200',
      'fields[lecture]': 'id,title,object_index,asset',
      'fields[chapter]': 'id,title,object_index',
      'fields[asset]': 'asset_type'
    });
    const data = await api(`${location.origin}/api-2.0/courses/${courseId}/subscriber-curriculum-items/?${params}`);
    let section = '';
    const lectures = [];
    for (const item of data.results || []) {
      if (item._class === 'chapter') section = item.title;
      else if (item._class === 'lecture' && (!item.asset?.asset_type || item.asset.asset_type === 'Video')) {
        lectures.push({ lectureId: String(item.id), title: item.title, section });
      }
    }
    const position = lectures.findIndex((l) => l.lectureId === ids[2]);
    out('aulas em video no curso', lectures.length);
    out('posicao da aula atual', position);
    out('proximas 3 que seriam adiantadas', lectures.slice(position + 1, position + 4));
  } catch (error) {
    console.error('Falha na API do curriculo:', error.message);
  }

  // --- player
  const video = [...document.querySelectorAll('video')].sort(
    (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width
  )[0];
  out('video encontrado', video ? { duration: video.duration, rate: video.playbackRate, volume: video.volume } : null);
  out(
    'text tracks no player',
    video ? [...video.textTracks].map((t) => ({ lang: t.language, mode: t.mode, cues: t.cues?.length || 0 })) : []
  );
})();
