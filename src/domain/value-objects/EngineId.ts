/** Identificadores dos motores suportados. */

export const TTS_ENGINE_IDS = [
  'kokoro',
  'piper',
  'f5',
  'inworld',
  'elevenlabs',
  'google',
  'deepgram'
] as const;

export type TtsEngineId = (typeof TTS_ENGINE_IDS)[number];

/** Motores que rodam em servidor HTTP na maquina do usuario. */
export const LOCAL_TTS_ENGINE_IDS = ['piper', 'kokoro', 'f5'] as const;
export type LocalTtsEngineId = (typeof LOCAL_TTS_ENGINE_IDS)[number];

export const STT_PROVIDER_IDS = ['deepgram', 'captions'] as const;
export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];

/** Identificador de voz dentro de um motor. Cada motor nomeia do seu jeito. */
export type VoiceId = string;

export function isTtsEngineId(value: unknown): value is TtsEngineId {
  return TTS_ENGINE_IDS.includes(value as TtsEngineId);
}

export function isLocalTtsEngineId(value: unknown): value is LocalTtsEngineId {
  return LOCAL_TTS_ENGINE_IDS.includes(value as LocalTtsEngineId);
}
