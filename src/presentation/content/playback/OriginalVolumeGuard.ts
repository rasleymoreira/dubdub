/*
 * Guarda o volume original do video enquanto a dublagem toca (Memento).
 *
 * Duas coisas tornam isto menos trivial do que parece:
 *
 * 1. A Udemy restaura o volume salvo dela ao trocar de aula, o que desfaz o
 *    abaixamento. Por isso reagimos a volumechange e reaplicamos.
 * 2. Reaplicar dispara outro volumechange. Sem distinguir a nossa alteracao da
 *    do usuario, isso vira laco infinito.
 *
 * Na versao anterior essas duas flags viviam soltas na classe do player
 * (savedVolume e applyingVolume), misturadas com sincronia e carregamento de
 * clipe: o classico Temporary Field. Aqui elas sao o estado inteiro de um
 * objeto que so faz isso.
 */

export class OriginalVolumeGuard {
  #video: HTMLVideoElement | null = null;
  /** Volume de antes da dublagem. null significa que nada foi alterado ainda. */
  #saved: number | null = null;
  /** True durante a nossa propria escrita, para ignorar o evento que ela gera. */
  #applying = false;
  #target = 0;

  attach(video: HTMLVideoElement | null): void {
    this.#video = video;
  }

  setTarget(volume: number): void {
    this.#target = Math.min(Math.max(volume, 0), 1);
  }

  /** Abaixa o original, guardando o valor atual na primeira vez. */
  apply(): void {
    const video = this.#video;
    if (!video) return;

    if (this.#saved === null) this.#saved = video.volume;
    if (Math.abs(video.volume - this.#target) < 0.005) return;

    this.#applying = true;
    video.volume = this.#target;
    // o evento chega no proximo tick da fila de tarefas
    setTimeout(() => {
      this.#applying = false;
    }, 0);
  }

  /** Devolve o volume que o usuario tinha antes. */
  restore(): void {
    const video = this.#video;
    if (!video || this.#saved === null) return;

    this.#applying = true;
    video.volume = this.#saved;
    this.#saved = null;
    setTimeout(() => {
      this.#applying = false;
    }, 0);
  }

  /**
   * Chamado no volumechange do video. Devolve true quando reaplicou, ou seja
   * quando alguem de fora mexeu no volume enquanto a dublagem esta ativa.
   */
  onVolumeChanged(enabled: boolean): boolean {
    if (!enabled || this.#applying) return false;
    this.apply();
    return true;
  }
}
