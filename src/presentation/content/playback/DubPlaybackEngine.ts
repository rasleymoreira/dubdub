/*
 * Reproducao da dublagem sincronizada com o video.
 *
 * A sincronia NAO e agendada de antemao. A cada tick comparamos onde a dublagem
 * deveria estar, derivado de video.currentTime, com onde ela esta, e corrigimos
 * a diferenca. Um agendamento previo teria de ser refeito a cada play, pause,
 * seek ou mudanca de velocidade; a comparacao periodica cobre os quatro casos
 * sem tratamento especial e sem acumular atraso.
 *
 * Esta classe ficou responsavel so pela coordenacao. A matematica esta em
 * PlaybackGeometry (dominio, testavel sem DOM), os elementos <audio> em
 * AudioSlotPool, o audio em ClipCache e o volume do original em
 * OriginalVolumeGuard. Antes tudo isso eram 531 linhas numa classe so.
 */

import {
  clipTimeFor,
  computeGeometry,
  findSegmentAt,
  firstIndexAfter,
  locatePart,
  playbackRateFor
} from '../../../domain/services/PlaybackGeometry.ts';
import type { DubManifest, ManifestSegment } from '../../../application/dto/DubManifest.ts';
import type { Logger } from '../../../application/ports/Logger.ts';
import { AudioSlotPool, applyPreservesPitch, type AudioSlot } from './AudioSlotPool.ts';
import { ClipCache, type ClipFetcher, type LoadedClip } from './ClipCache.ts';
import { OriginalVolumeGuard } from './OriginalVolumeGuard.ts';

const TICK_MS = 100;
/** Defasagem tolerada antes de corrigir a posicao do audio. */
const DRIFT_TOLERANCE_S = 0.25;
/** Intervalo minimo entre correcoes no mesmo trecho, para nao ficar picotando. */
const MIN_FIX_INTERVAL_MS = 400;
/** Folga estimada de duracao quando o clipe ainda nao foi carregado. */
const UNLOADED_WINDOW_PADDING_S = 1.5;

export interface PlaybackSettings {
  readonly originalVolume: number;
  readonly dubVolume: number;
  readonly maxSpeedup: number;
}

export interface PlaybackStatus {
  readonly enabled: boolean;
  readonly hasDub: boolean;
  readonly total: number;
  readonly ready: number;
  readonly key: string | null;
  readonly engine: string | null;
  readonly lang: string | null;
}

interface CurrentPlayback {
  index: number;
  partIndex: number;
  slot: AudioSlot;
  lastFix: number;
}

export interface DubPlaybackEngineDeps {
  readonly fetchClips: ClipFetcher;
  readonly onStatus: (status: PlaybackStatus) => void;
  readonly logger: Logger;
}

export class DubPlaybackEngine {
  readonly #pool = new AudioSlotPool();
  readonly #clips: ClipCache;
  readonly #volume = new OriginalVolumeGuard();
  readonly #onStatus: (status: PlaybackStatus) => void;

  #video: HTMLVideoElement | null = null;
  #manifest: DubManifest | null = null;
  #segments: readonly ManifestSegment[] = [];
  #current: CurrentPlayback | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #enabled = false;

  #dubVolume = 1;
  #maxSpeedup = 1.25;

  readonly #videoHandlers: Record<string, () => void> = {
    play: () => this.#tick(),
    playing: () => this.#tick(),
    pause: () => this.#pauseCurrent(),
    seeking: () => this.#pauseCurrent(),
    seeked: () => this.#tick(),
    ratechange: () => this.#tick(),
    volumechange: () => this.#volume.onVolumeChanged(this.#enabled),
    emptied: () => this.#stopCurrent(),
    ended: () => this.#stopCurrent()
  };

  constructor(deps: DubPlaybackEngineDeps) {
    this.#clips = new ClipCache(deps.fetchClips, deps.logger, (url) => this.#pool.releaseUrl(url));
    this.#onStatus = deps.onStatus;
  }

  // ------------------------------------------------------------------ ligacao

  attach(video: HTMLVideoElement | null): void {
    if (this.#video === video) return;
    this.detach();

    this.#video = video;
    this.#volume.attach(video);
    if (!video) return;

    for (const [event, handler] of Object.entries(this.#videoHandlers)) {
      video.addEventListener(event, handler);
    }
    if (this.#enabled) this.#volume.apply();
  }

  detach(): void {
    this.#stopCurrent();
    if (this.#video) {
      for (const [event, handler] of Object.entries(this.#videoHandlers)) {
        this.#video.removeEventListener(event, handler);
      }
      this.#volume.restore();
    }
    this.#video = null;
    this.#volume.attach(null);
  }

  get video(): HTMLVideoElement | null {
    return this.#video;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get manifest(): DubManifest | null {
    return this.#manifest;
  }

  hasDub(): boolean {
    return this.#manifest !== null && this.#segments.length > 0;
  }

  applySettings(settings: PlaybackSettings): void {
    this.#volume.setTarget(settings.originalVolume);
    this.#dubVolume = clamp01(settings.dubVolume);
    this.#maxSpeedup = Math.min(Math.max(settings.maxSpeedup, 1), 2);

    if (this.#current) this.#current.slot.element.volume = this.#dubVolume;
    if (this.#enabled) this.#volume.apply();
  }

  setManifest(manifest: DubManifest | null): void {
    this.#manifest = manifest;
    this.#segments = manifest?.segments ?? [];
    this.#clips.reset(manifest?.key ?? null);
    this.#stopCurrent();
    this.#emit();
    if (this.#enabled) this.#tick();
  }

  /** O job gerou mais trechos: volta a tentar os que faltavam. */
  refreshAvailability(manifest?: DubManifest): void {
    if (manifest && manifest.key === this.#manifest?.key) {
      this.#manifest = manifest;
      this.#segments = manifest.segments;
    }
    this.#clips.markStale();
  }

  // ------------------------------------------------------------ liga/desliga

  enable(): boolean {
    if (!this.hasDub() || !this.#video) return false;

    this.#enabled = true;
    this.#volume.apply();
    this.#timer ??= setInterval(() => this.#tick(), TICK_MS);
    this.#tick();
    this.#emit();
    return true;
  }

  disable(): void {
    this.#enabled = false;
    this.#stopCurrent();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#volume.restore();
    this.#emit();
  }

  toggle(): boolean {
    if (this.#enabled) {
      this.disable();
      return false;
    }
    return this.enable();
  }

  destroy(): void {
    this.disable();
    this.detach();
    this.#clips.destroy();
    this.#pool.releaseAll();
  }

  // -------------------------------------------------------------- reproducao

  #tick(): void {
    const video = this.#video;
    if (!this.#enabled || !video || !this.hasDub()) return;

    // silencio esperado: o usuario parou, buscou, ou mutou o proprio video
    if (video.paused || video.ended || video.seeking || video.muted) {
      this.#pauseCurrent();
      return;
    }

    const time = video.currentTime;
    const index = findSegmentAt(this.#segments, time, (i) => this.#windowFor(i));

    if (index === -1) {
      this.#pauseCurrent();
      this.#clips.prefetch(firstIndexAfter(this.#segments, time), this.#segments.length);
      return;
    }

    const clip = this.#clips.get(index);
    if (!clip) {
      this.#pauseCurrent();
      this.#clips.prefetch(index, this.#segments.length);
      return;
    }

    const segment = this.#segments[index]!;
    const geometry = computeGeometry(
      segment,
      this.#segments[index + 1],
      clip.total,
      this.#maxSpeedup
    );
    const clipTime = clipTimeFor(time, segment, geometry.fit);

    // a fala deste trecho ja acabou; o proximo ainda nao comecou
    if (clipTime >= clip.total - 0.02) {
      this.#pauseCurrent();
      this.#clips.prefetch(index + 1, this.#segments.length);
      return;
    }

    const spot = locatePart(
      clip.parts.map((part) => part.duration),
      clipTime
    );

    this.#play(
      index,
      spot.partIndex,
      spot.offset,
      playbackRateFor(video.playbackRate || 1, geometry.fit),
      clip
    );
    this.#clips.prefetch(index, this.#segments.length);
    this.#clips.evict(index);
  }

  /**
   * Quanto tempo do video este trecho ocupa. Com o clipe carregado sabemos a
   * duracao real; sem ele, estimamos pela janela da legenda mais uma folga,
   * senao o trecho seria considerado terminado antes de ser carregado.
   */
  #windowFor(index: number): number {
    const segment = this.#segments[index]!;
    const clip = this.#clips.get(index);
    if (!clip) return segment.end - segment.start + UNLOADED_WINDOW_PADDING_S;

    return computeGeometry(segment, this.#segments[index + 1], clip.total, this.#maxSpeedup)
      .dubDuration;
  }

  #play(index: number, partIndex: number, offset: number, rate: number, clip: LoadedClip): void {
    const current = this.#current;

    // ja tocando a parte certa: so ajustar velocidade e corrigir deriva
    if (current && current.index === index && current.partIndex === partIndex) {
      const element = current.slot.element;
      element.playbackRate = rate;
      element.volume = this.#dubVolume;

      const drift = element.currentTime - offset;
      const now = performance.now();
      if (Math.abs(drift) > DRIFT_TOLERANCE_S && now - current.lastFix > MIN_FIX_INTERVAL_MS) {
        seek(current.slot, offset);
        current.lastFix = now;
      }

      if (element.paused) void element.play().catch(() => undefined);
      return;
    }

    this.#pauseCurrent();

    const part = clip.parts[partIndex];
    if (!part) return;

    const slot = this.#pool.acquire(part.url, this.#current?.slot ?? null);
    slot.element.playbackRate = rate;
    slot.element.volume = this.#dubVolume;
    applyPreservesPitch(slot.element);

    if (offset > 0.02) seek(slot, offset);
    else if (slot.element.currentTime > 0.02) seek(slot, 0);

    // sem gesto do usuario o play e recusado; o proximo tick tenta de novo
    void slot.element.play().catch(() => undefined);
    this.#current = { index, partIndex, slot, lastFix: performance.now() };

    this.#preroll(index, partIndex + 1, clip);
  }

  /** Deixa a proxima parte carregada para a troca nao dar buraco audivel. */
  #preroll(index: number, partIndex: number, clip: LoadedClip): void {
    const next = clip.parts[partIndex] ?? this.#clips.get(index + 1)?.parts[0];
    if (next) this.#pool.acquire(next.url, this.#current?.slot ?? null, false);
  }

  #pauseCurrent(): void {
    this.#current?.slot.element.pause();
  }

  #stopCurrent(): void {
    this.#pauseCurrent();
    this.#current = null;
  }

  #emit(): void {
    this.#onStatus({
      enabled: this.#enabled,
      hasDub: this.hasDub(),
      total: this.#segments.length,
      ready: this.#manifest?.ready ?? 0,
      key: this.#manifest?.key ?? null,
      engine: this.#manifest?.ttsEngine ?? null,
      lang: this.#manifest?.targetLang ?? null
    });
  }
}

/** currentTime antes dos metadados carregarem lanca: espera o loadedmetadata. */
function seek(slot: AudioSlot, offset: number): void {
  const apply = (): void => {
    try {
      slot.element.currentTime = offset;
    } catch {
      /* metadados ainda nao chegaram */
    }
  };

  if (slot.element.readyState >= 1) apply();
  else slot.element.addEventListener('loadedmetadata', apply, { once: true });
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
