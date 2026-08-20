/*
 * Pool de elementos <audio> (Object Pool).
 *
 * Uma aula tem centenas de trechos. Criar um <audio> por trecho criaria
 * centenas de decodificadores, entao poucos elementos sao reaproveitados,
 * trocando so o src.
 *
 * Por que <audio> e nao AudioBufferSourceNode: o elemento tem preservesPitch.
 * Acelerar a fala para acompanhar um video em 1.5x ou 2x usa o time-stretch do
 * Chrome e a voz nao fica fina. Com a Web Audio API isso teria de ser
 * implementado a mao.
 */

const DEFAULT_SIZE = 3;

export class AudioSlot {
  readonly element: HTMLAudioElement;
  url: string | null = null;
  lastUsed = 0;

  constructor() {
    this.element = new Audio();
    this.element.preload = 'auto';
    applyPreservesPitch(this.element);
  }

  load(url: string): void {
    if (this.url === url) return;
    this.element.pause();
    this.element.src = url;
    this.url = url;
    this.element.load();
  }

  release(): void {
    this.element.pause();
    this.element.removeAttribute('src');
    this.url = null;
  }
}

/** Os prefixos existem por compatibilidade com versoes antigas do WebKit. */
export function applyPreservesPitch(element: HTMLAudioElement): void {
  const audio = element as HTMLAudioElement & {
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  audio.preservesPitch = true;
  audio.mozPreservesPitch = true;
  audio.webkitPreservesPitch = true;
}

export class AudioSlotPool {
  readonly #slots: AudioSlot[];

  constructor(size = DEFAULT_SIZE) {
    this.#slots = Array.from({ length: size }, () => new AudioSlot());
  }

  /**
   * Slot que ja tem esta URL carregada ou, se nao houver, o menos usado
   * recentemente. `keepCurrent` evita despejar o slot que esta tocando, o que
   * causaria um corte audivel.
   */
  acquire(url: string, busy: AudioSlot | null, touch = true): AudioSlot {
    const loaded = this.#slots.find((slot) => slot.url === url);
    if (loaded) {
      if (touch) loaded.lastUsed = performance.now();
      return loaded;
    }

    const available = this.#slots.filter((slot) => slot !== busy);
    const victim = [...available].sort((a, b) => a.lastUsed - b.lastUsed)[0] ?? this.#slots[0]!;
    victim.load(url);
    if (touch) victim.lastUsed = performance.now();
    return victim;
  }

  /** Libera qualquer slot que esteja segurando esta URL. */
  releaseUrl(url: string): void {
    for (const slot of this.#slots) {
      if (slot.url === url) slot.release();
    }
  }

  releaseAll(): void {
    for (const slot of this.#slots) slot.release();
  }
}
