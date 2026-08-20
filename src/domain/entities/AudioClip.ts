/**
 * Audio sintetizado de um trecho.
 *
 * `parts` e uma lista porque alguns provedores limitam o tamanho por
 * requisicao (o TTS do Google corta em ~200 caracteres), entao um trecho pode
 * virar varios arquivos que o player toca em sequencia.
 *
 * O conteudo vai em base64 porque as mensagens do chrome.runtime sao
 * serializadas em JSON: binario nao atravessa a fronteira entre o service
 * worker e o content script.
 */
export interface AudioClip {
  readonly parts: readonly string[];
  readonly mime: string;
}

export function isEmpty(clip: AudioClip): boolean {
  return clip.parts.length === 0 || clip.parts.every((part) => part.length === 0);
}
