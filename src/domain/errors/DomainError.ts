/**
 * Erros do dominio.
 *
 * O codigo antigo lancava `new Error('mensagem em portugues')` de dentro dos
 * clientes HTTP, misturando regra, transporte e texto de UI numa coisa so. Aqui
 * o erro carrega dado estruturado e quem apresenta decide como escrever.
 */

export class DomainError extends Error {
  override readonly name: string = 'DomainError';

  constructor(message: string) {
    super(message);
  }
}

/** O job foi cancelado pelo usuario. Nunca deve virar retry nem mensagem de erro. */
export class CanceledError extends DomainError {
  override readonly name = 'CanceledError';

  constructor() {
    super('operacao cancelada');
  }
}

/** Nao ha texto de origem: nem legenda, nem audio acessivel. */
export class NoTranscriptSourceError extends DomainError {
  override readonly name = 'NoTranscriptSourceError';

  readonly lectureId: string;

  constructor(lectureId: string) {
    super(`sem legendas nem audio acessivel para a aula ${lectureId}`);
    this.lectureId = lectureId;
  }
}

/** Falha vinda de um provedor externo (HTTP, servidor local, native host). */
export class ProviderError extends DomainError {
  override readonly name = 'ProviderError';

  readonly provider: string;
  readonly status: number | undefined;
  readonly body: string | undefined;

  constructor(provider: string, message: string, status?: number, body?: string) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.body = body;
  }

  /**
   * 429, 408 e 5xx sao transitorios. Ausencia de status significa falha de rede,
   * que tambem vale repetir. Credencial invalida (401/403) nao melhora com retry.
   */
  get retriable(): boolean {
    if (this.status === undefined) return true;
    if (this.status === 401 || this.status === 403) return false;
    return this.status === 429 || this.status === 408 || this.status >= 500;
  }
}

/** O servidor de TTS local nao respondeu. Carrega a dica de como subir. */
export class LocalServerUnavailableError extends DomainError {
  override readonly name = 'LocalServerUnavailableError';

  readonly engine: string;
  readonly baseUrl: string;
  /** Como subir o servidor, para a mensagem da UI ser acionavel. */
  readonly hint: string;
  readonly detail: string | undefined;

  constructor(engine: string, baseUrl: string, hint: string, detail?: string) {
    super(`${engine} nao respondeu em ${baseUrl}`);
    this.engine = engine;
    this.baseUrl = baseUrl;
    this.hint = hint;
    this.detail = detail;
  }
}
