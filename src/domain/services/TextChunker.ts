/*
 * Quebra de texto em pedacos que caibam no limite de uma requisicao de TTS.
 *
 * A quebra e hierarquica e nessa ordem de preferencia: frase, virgula, palavra.
 * Cortar no meio de uma frase e audivel; cortar entre frases nao e.
 */

export function chunkText(text: string, maxLength: number): string[] {
  const clean = String(text).trim();
  if (clean.length <= maxLength) return clean ? [clean] : [];

  const pieces: string[] = [];
  let buffer = '';

  const flush = (): void => {
    const value = buffer.trim();
    if (value) pieces.push(value);
    buffer = '';
  };

  const sentences = clean.match(/[^.!?…;]+[.!?…;]*\s*/g) ?? [clean];
  for (const sentence of sentences) {
    if ((buffer + sentence).trim().length <= maxLength) {
      buffer += sentence;
      continue;
    }
    flush();
    if (sentence.trim().length <= maxLength) {
      buffer = sentence;
      continue;
    }

    for (const clause of sentence.split(/(?<=,)\s*/)) {
      if ((buffer + clause).trim().length <= maxLength) {
        buffer += clause;
        continue;
      }
      flush();
      if (clause.trim().length <= maxLength) {
        buffer = clause;
        continue;
      }

      for (const word of clause.split(/\s+/)) {
        if ((buffer + ' ' + word).trim().length <= maxLength) {
          buffer += (buffer ? ' ' : '') + word;
        } else {
          flush();
          buffer = word.slice(0, maxLength);
        }
      }
    }
  }

  flush();
  return pieces;
}
