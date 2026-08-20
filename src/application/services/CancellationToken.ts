/**
 * Cancelamento cooperativo de um job.
 *
 * Um job atravessa transcricao, traducao e centenas de chamadas de TTS. O token
 * e passado a todas elas e verificado nos pontos de retomada, entao cancelar
 * para o trabalho em ate uma requisicao, sem matar nada no meio.
 */

import { CanceledError } from '../../domain/errors/DomainError.ts';

/** Lado leitor: e o que os adapters recebem. */
export interface CancellationSignal {
  readonly canceled: boolean;
  /** Lanca CanceledError se ja foi cancelado. */
  throwIfCanceled(): void;
}

export class CancellationToken implements CancellationSignal {
  #canceled = false;

  get canceled(): boolean {
    return this.#canceled;
  }

  cancel(): void {
    this.#canceled = true;
  }

  throwIfCanceled(): void {
    if (this.#canceled) throw new CanceledError();
  }
}

/** Token que nunca cancela, para chamadas avulsas (testes de credencial). */
export const NEVER_CANCELED: CancellationSignal = {
  canceled: false,
  throwIfCanceled(): void {
    /* nada a fazer */
  }
};
