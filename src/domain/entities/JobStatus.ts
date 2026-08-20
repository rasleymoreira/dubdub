/** Etapas de um job de dublagem, na ordem em que acontecem. */

export const JobStatus = {
  IDLE: 'idle',
  CONTEXT: 'context',
  TRANSCRIBING: 'transcribing',
  TRANSLATING: 'translating',
  SYNTHESIZING: 'synthesizing',
  DONE: 'done',
  ERROR: 'error',
  CANCELED: 'canceled'
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/** Estados finais: o job nao produz mais progresso depois deles. */
const TERMINAL: readonly JobStatus[] = [JobStatus.DONE, JobStatus.ERROR, JobStatus.CANCELED];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL.includes(status);
}
