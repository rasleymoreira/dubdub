/**
 * Hash curto e estavel (FNV-1a) usado em chaves de cache de traducao.
 *
 * Nao e criptografico e nao precisa ser: so precisa ser deterministico entre
 * sessoes e curto o bastante para virar chave de IndexedDB.
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  const value = String(text);
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
