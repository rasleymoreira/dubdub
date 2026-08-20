/*
 * Motor de reproducao da dublagem.
 *
 * O audio original do <video> vai a zero e a dublagem toca em elementos <audio>
 * paralelos. Usamos elementos (e nao AudioBufferSourceNode) de proposito: o
 * <audio> tem `preservesPitch`, entao acelerar a fala para acompanhar o video em
 * 1.5x/2x usa o time-stretch do Chrome e a voz nao fica fina.
 *
 * Sincronia: a cada 100ms comparamos onde a dublagem deveria estar (derivado de
 * video.currentTime) com onde ela esta, e corrigimos. Isso cobre play, pause,
 * seek e mudanca de velocidade sem agendamento previo.
 */

var UDUB_Engine = (function () {
  'use strict';

  const TICK_MS = 100;
  const PREFETCH_SEGMENTS = 10;
  const CLIP_BATCH = 8;
  const KEEP_BEHIND = 15;
  const KEEP_AHEAD = 60;
  const DRIFT_TOLERANCE = 0.25; // segundos de defasagem aceitos antes de corrigir
  const MIN_FIX_INTERVAL = 400; // ms entre correcoes no mesmo trecho
  const SLOT_COUNT = 3;
  const PROBE_TIMEOUT = 6000;
  const MAX_RATE = 4; // acima disso o Chrome silencia o audio

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function base64ToBlob(base64, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'audio/mpeg' });
  }

  function setPreservesPitch(el) {
    el.preservesPitch = true;
    el.mozPreservesPitch = true;
    el.webkitPreservesPitch = true;
  }

  /** Duracao real do clipe, medida pelo proprio decodificador do navegador. */
  function probeDuration(url) {
    return new Promise((resolve) => {
      const el = new Audio();
      el.preload = 'metadata';
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        el.onloadedmetadata = null;
        el.onerror = null;
        el.removeAttribute('src');
        resolve(value);
      };
      const timer = setTimeout(() => finish(0), PROBE_TIMEOUT);
      el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => finish(0);
      el.src = url;
    });
  }

  /** Um <audio> reutilizavel: evita criar dezenas de decodificadores. */
  class Slot {
    constructor() {
      this.el = new Audio();
      this.el.preload = 'auto';
      setPreservesPitch(this.el);
      this.url = null;
      this.lastUsed = 0;
    }

    load(url) {
      if (this.url === url) return;
      this.el.pause();
      this.el.src = url;
      this.url = url;
      this.el.load();
    }

    release() {
      this.el.pause();
      this.el.removeAttribute('src');
      this.url = null;
    }
  }

  class DubEngine {
    constructor(options) {
      this.requestClips = options.requestClips;
      this.onStatus = options.onStatus || function () {};

      this.video = null;
      this.manifest = null;
      this.segments = [];

      this.clips = new Map(); // indice -> { parts: [{url, duration}], total }
      this.loading = new Set();
      this.absent = new Set();

      this.slots = Array.from({ length: SLOT_COUNT }, () => new Slot());
      this.current = null; // { index, partIndex, slot, lastFix }

      this.enabled = false;
      this.timer = null;

      this.originalVolume = 0;
      this.dubVolume = 1;
      this.maxSpeedup = 1.25;

      this.savedVolume = null;
      this.applyingVolume = false;

      this.videoHandlers = {
        play: () => this._tick(),
        playing: () => this._tick(),
        pause: () => this._pauseCurrent(),
        seeking: () => this._pauseCurrent(),
        seeked: () => this._tick(),
        ratechange: () => this._tick(),
        volumechange: () => this._onVolumeChange(),
        emptied: () => this._stopCurrent(),
        ended: () => this._stopCurrent()
      };
    }

    // ---------------------------------------------------------------- ligacao

    attach(video) {
      if (this.video === video) return;
      this.detach();
      this.video = video;
      if (!video) return;
      for (const [event, handler] of Object.entries(this.videoHandlers)) {
        video.addEventListener(event, handler);
      }
      if (this.enabled) this._applyOriginalVolume();
    }

    detach() {
      this._stopCurrent();
      if (this.video) {
        for (const [event, handler] of Object.entries(this.videoHandlers)) {
          this.video.removeEventListener(event, handler);
        }
        this._restoreOriginalVolume();
      }
      this.video = null;
    }

    applySettings(settings) {
      if (!settings) return;
      if (typeof settings.originalVolume === 'number') this.originalVolume = clamp(settings.originalVolume, 0, 1);
      if (typeof settings.dubVolume === 'number') this.dubVolume = clamp(settings.dubVolume, 0, 1);
      if (typeof settings.maxSpeedup === 'number') this.maxSpeedup = clamp(settings.maxSpeedup, 1, 2);
      if (this.current) this.current.slot.el.volume = this.dubVolume;
      if (this.enabled) this._applyOriginalVolume();
    }

    setManifest(manifest) {
      const changed = manifest?.key !== this.manifest?.key;
      this.manifest = manifest || null;
      this.segments = manifest?.segments || [];
      if (changed) {
        this._stopCurrent();
        for (const clip of this.clips.values()) this._releaseClip(clip);
        this.clips.clear();
        this.loading.clear();
      }
      this.absent.clear();
      this._emit();
      if (this.enabled) this._tick();
    }

    /** Novos trechos ficaram prontos: volta a tentar os que faltavam. */
    refreshAvailability(manifest) {
      if (manifest && manifest.key === this.manifest?.key) {
        this.manifest = manifest;
        this.segments = manifest.segments || this.segments;
      }
      this.absent.clear();
    }

    hasDub() {
      return Boolean(this.manifest && this.segments.length);
    }

    // ------------------------------------------------------------ liga/desliga

    async enable() {
      if (!this.hasDub() || !this.video) return false;
      this.enabled = true;
      this._applyOriginalVolume();
      if (!this.timer) this.timer = setInterval(() => this._tick(), TICK_MS);
      this._tick();
      this._emit();
      return true;
    }

    disable() {
      this.enabled = false;
      this._stopCurrent();
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this._restoreOriginalVolume();
      this._emit();
    }

    async toggle() {
      if (this.enabled) {
        this.disable();
        return false;
      }
      return this.enable();
    }

    destroy() {
      this.disable();
      this.detach();
      for (const clip of this.clips.values()) this._releaseClip(clip);
      this.clips.clear();
      for (const slot of this.slots) slot.release();
    }

    // ------------------------------------------------------- volume do original

    _applyOriginalVolume() {
      const video = this.video;
      if (!video) return;
      if (this.savedVolume === null) this.savedVolume = video.volume;
      if (Math.abs(video.volume - this.originalVolume) < 0.005) return;
      this.applyingVolume = true;
      video.volume = this.originalVolume;
      setTimeout(() => {
        this.applyingVolume = false;
      }, 0);
    }

    _restoreOriginalVolume() {
      const video = this.video;
      if (!video || this.savedVolume === null) return;
      this.applyingVolume = true;
      video.volume = this.savedVolume;
      this.savedVolume = null;
      setTimeout(() => {
        this.applyingVolume = false;
      }, 0);
    }

    /** A Udemy restaura o volume salvo dela ao trocar de aula: reaplicamos. */
    _onVolumeChange() {
      if (!this.enabled || this.applyingVolume) return;
      this._applyOriginalVolume();
    }

    // ------------------------------------------------------------- reproducao

    _tick() {
      if (!this.enabled || !this.video || !this.hasDub()) return;
      const video = this.video;

      if (video.paused || video.ended || video.seeking || video.muted) {
        this._pauseCurrent();
        return;
      }

      const time = video.currentTime;
      const rate = video.playbackRate || 1;
      const index = this._segmentIndexAt(time);

      if (index === -1) {
        this._pauseCurrent();
        this._prefetch(this._firstIndexAfter(time));
        return;
      }

      const clip = this.clips.get(index);
      if (!clip) {
        this._pauseCurrent();
        this._loadClips(index);
        return;
      }

      const geometry = this._geometry(index, clip);
      const clipTime = (time - this.segments[index].start) * geometry.fit;
      if (clipTime >= clip.total - 0.02) {
        this._pauseCurrent();
        this._prefetch(index + 1);
        return;
      }

      const spot = this._locatePart(clip, clipTime);
      this._play(index, spot.partIndex, spot.offset, clamp(rate * geometry.fit, 0.25, MAX_RATE), clip);
      this._prefetch(index);
      this._evict(index);
    }

    /** Ultimo segmento que ja comecou e ainda esta dentro da propria janela. */
    _segmentIndexAt(time) {
      const segments = this.segments;
      let low = 0;
      let high = segments.length - 1;
      let found = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (segments[middle].start <= time + 0.03) {
          found = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (found === -1) return -1;

      const segment = segments[found];
      const clip = this.clips.get(found);
      const window = clip
        ? this._geometry(found, clip).dubDuration
        : segment.end - segment.start + 1.5;
      return time > segment.start + window ? -1 : found;
    }

    _firstIndexAfter(time) {
      const segments = this.segments;
      let low = 0;
      let high = segments.length - 1;
      let found = segments.length;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (segments[middle].start >= time) {
          found = middle;
          high = middle - 1;
        } else {
          low = middle + 1;
        }
      }
      return found;
    }

    /**
     * Quanto a fala dublada precisa ser acelerada para caber no espaco ate a
     * proxima fala. O intervalo de silencio entre falas conta como espaco util,
     * o que na pratica dispensa aceleracao na maioria dos trechos.
     */
    _geometry(index, clip) {
      const segment = this.segments[index];
      const next = this.segments[index + 1];
      const budget = Math.max(0.4, (next ? next.start : segment.end + 2) - segment.start);
      const fit = clamp(clip.total / budget, 1, this.maxSpeedup);
      return { fit, budget, dubDuration: clip.total / fit };
    }

    _locatePart(clip, clipTime) {
      let accumulated = 0;
      for (let part = 0; part < clip.parts.length; part++) {
        const duration = clip.parts[part].duration;
        if (clipTime < accumulated + duration || part === clip.parts.length - 1) {
          return { partIndex: part, offset: Math.max(0, clipTime - accumulated) };
        }
        accumulated += duration;
      }
      return { partIndex: 0, offset: 0 };
    }

    _play(index, partIndex, offset, rate, clip) {
      const current = this.current;

      if (current && current.index === index && current.partIndex === partIndex) {
        const el = current.slot.el;
        el.playbackRate = rate;
        el.volume = this.dubVolume;
        const drift = el.currentTime - offset;
        const now = performance.now();
        if (Math.abs(drift) > DRIFT_TOLERANCE && now - current.lastFix > MIN_FIX_INTERVAL) {
          this._seekSlot(current.slot, offset);
          current.lastFix = now;
        }
        if (el.paused) el.play().catch(() => {});
        return;
      }

      this._pauseCurrent();
      const part = clip.parts[partIndex];
      const slot = this._slotFor(part.url);
      slot.el.playbackRate = rate;
      slot.el.volume = this.dubVolume;
      setPreservesPitch(slot.el);
      if (offset > 0.02) this._seekSlot(slot, offset);
      else if (slot.el.currentTime > 0.02) this._seekSlot(slot, 0);
      slot.el.play().catch(() => {
        /* sem gesto do usuario ainda: tentamos de novo no proximo tick */
      });
      this.current = { index, partIndex, slot, lastFix: performance.now() };

      this._preroll(index, partIndex + 1, clip);
    }

    _seekSlot(slot, offset) {
      const apply = () => {
        try {
          slot.el.currentTime = offset;
        } catch {
          /* metadados ainda nao carregaram */
        }
      };
      if (slot.el.readyState >= 1) apply();
      else slot.el.addEventListener('loadedmetadata', apply, { once: true });
    }

    /** Deixa a proxima parte carregada para a troca nao dar buraco. */
    _preroll(index, partIndex, clip) {
      let next = clip.parts[partIndex];
      if (!next) {
        const nextClip = this.clips.get(index + 1);
        next = nextClip?.parts?.[0];
      }
      if (next) this._slotFor(next.url, true);
    }

    _slotFor(url, keepCurrent) {
      let slot = this.slots.find((candidate) => candidate.url === url);
      if (!slot) {
        const busy = this.current?.slot;
        const pool = this.slots.filter((candidate) => candidate !== busy);
        slot = pool.sort((a, b) => a.lastUsed - b.lastUsed)[0] || this.slots[0];
        slot.load(url);
      }
      if (!keepCurrent) slot.lastUsed = performance.now();
      return slot;
    }

    _pauseCurrent() {
      if (this.current) this.current.slot.el.pause();
    }

    _stopCurrent() {
      this._pauseCurrent();
      this.current = null;
    }

    // ------------------------------------------------------------------ clipes

    _prefetch(start) {
      const end = Math.min(this.segments.length, Math.max(0, start) + PREFETCH_SEGMENTS);
      for (let index = Math.max(0, start); index < end; index++) {
        if (!this.clips.has(index) && !this.loading.has(index) && !this.absent.has(index)) {
          this._loadClips(index);
          return; // um lote por tick
        }
      }
    }

    _evict(start) {
      if (this.clips.size < KEEP_BEHIND + KEEP_AHEAD + 10) return;
      for (const [index, clip] of this.clips) {
        if (index < start - KEEP_BEHIND || index > start + KEEP_AHEAD) {
          this._releaseClip(clip);
          this.clips.delete(index);
        }
      }
    }

    _releaseClip(clip) {
      for (const part of clip.parts) {
        for (const slot of this.slots) if (slot.url === part.url) slot.release();
        URL.revokeObjectURL(part.url);
      }
    }

    async _loadClips(index) {
      if (this.loading.has(index) || this.clips.has(index) || this.absent.has(index)) return;
      const from = index;
      const to = Math.min(this.segments.length, from + CLIP_BATCH);
      for (let i = from; i < to; i++) this.loading.add(i);

      try {
        const rows = (await this.requestClips(this.manifest.key, from, to - from)) || [];
        const received = new Set();

        for (const row of rows) {
          try {
            const parts = [];
            let total = 0;
            for (const encoded of row.parts || []) {
              const url = URL.createObjectURL(base64ToBlob(encoded, row.mime));
              const duration = await probeDuration(url);
              if (!duration) {
                URL.revokeObjectURL(url);
                continue;
              }
              parts.push({ url, duration });
              total += duration;
            }
            if (parts.length) {
              this.clips.set(row.i, { parts, total });
              received.add(row.i);
            }
          } catch (error) {
            console.warn('[udub] falha ao preparar trecho', row.i, error);
          }
        }

        for (let i = from; i < to; i++) if (!received.has(i)) this.absent.add(i);
      } catch (error) {
        console.warn('[udub] falha ao buscar clipes', error);
      } finally {
        for (let i = from; i < to; i++) this.loading.delete(i);
      }
    }

    // ------------------------------------------------------------------ estado

    _emit() {
      this.onStatus({
        enabled: this.enabled,
        hasDub: this.hasDub(),
        total: this.segments.length,
        ready: this.manifest?.ready ?? 0,
        key: this.manifest?.key || null,
        engine: this.manifest?.ttsEngine || null,
        lang: this.manifest?.targetLang || null
      });
    }
  }

  return { DubEngine };
})();
