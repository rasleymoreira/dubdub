/**
 * Porta de verificacao de credenciais e catalogos, usada pelos botoes Testar
 * do popup. Separada da sintese porque nao participa de nenhum job.
 */

import type { VoiceId } from '../../domain/value-objects/EngineId.ts';

export interface RemoteVoice {
  readonly id: VoiceId;
  readonly name: string;
  readonly description?: string;
}

export interface QuotaInfo {
  readonly tier: string;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
}

export interface CredentialTestResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly voices?: readonly RemoteVoice[];
  readonly quota?: QuotaInfo;
  readonly projects?: readonly string[];
  readonly device?: string | null;
  /** Formato de protocolo que funcionou, para servidores locais. */
  readonly mode?: string;
}

export interface CredentialTestPort {
  test(input: {
    apiKey?: string;
    url?: string;
    voice?: string;
    language?: string;
  }): Promise<CredentialTestResult>;
}
