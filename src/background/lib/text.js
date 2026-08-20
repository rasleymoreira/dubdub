/*
 * Preparo do texto antes do TTS.
 *
 * Legenda de video vem picada em linhas curtas, sem pontuacao e com marcacoes
 * que nao sao fala ([MUSIC], ">> INSTRUCTOR:"). Jogar isso direto no sintetizador
 * produz leitura truncada, com entonacao de fim de frase no meio da oracao.
 * Aqui o texto vira frase corrida, com pontuacao coerente.
 */

const NON_SPEECH = /^(music|musica|música|applause|aplausos|laughter|risos|silence|silencio|silêncio|inaudible|inaudivel|inaudível|sound|som|noise|ruido|ruído)[\s.!]*$/i;

/** Marcadores de nao-fala entre colchetes ou parenteses. */
function stripNonSpeech(text) {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(([^)]*)\)/g, (full, inner) => (NON_SPEECH.test(inner.trim()) ? ' ' : full));
}

/** ">> JOHN:" / "INSTRUCTOR:" no inicio da fala. */
function stripSpeakerLabel(text) {
  return text.replace(/^\s*>>+\s*/, '').replace(/^\s*[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ .'-]{1,24}:\s+/, '');
}

/** Legenda inteira em caixa alta faz o TTS soletrar: vira frase normal. */
function fixShouting(text) {
  if (text.length < 12) return text;
  if (/[a-zà-ÿ]/.test(text)) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Normaliza um trecho para ser falado.
 * `dedupe` remove palavras repetidas em sequencia (artefato de legenda
 * automatica) — usado so no texto de origem, nunca no traduzido.
 */
export function normalizeForSpeech(text, options = {}) {
  let out = String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/ /g, ' ');

  out = stripNonSpeech(out);
  out = stripSpeakerLabel(out);

  out = out
    // palavra cortada pela quebra de linha: "exem- plo" -> "exemplo"
    .replace(/(\p{L})-\s+(\p{L})/gu, '$1$2')
    // travessao/bullet no inicio
    .replace(/^\s*[-–—•*]\s+/, '')
    // reticencias viram pausa curta em vez de suspense
    .replace(/\s*\.{3,}\s*/g, ', ')
    .replace(/\s*…\s*/g, ', ')
    // pontuacao repetida
    .replace(/([.!?])\1{1,}/g, '$1')
    // espaco antes da pontuacao
    .replace(/\s+([,.;:!?])/g, '$1')
    // pontuacao colada na palavra seguinte (nao mexe em numeros: 1.500)
    .replace(/([,;:])(?=\S)/g, '$1 ')
    .replace(/([.!?])(?=\p{Lu})/gu, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (options.dedupe) {
    // "the the server" -> "the server"
    out = out.replace(/\b(\p{L}{2,})(\s+\1\b)+/giu, '$1');
  }

  out = fixShouting(out);
  if (out) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}

/**
 * Garante que todo trecho termine com pontuacao. Sem isso o sintetizador lê a
 * ultima palavra com entonacao suspensa. Se a frase continua no proximo trecho
 * usamos virgula (pausa), senao ponto (fim de frase).
 */
export function addContinuityPunctuation(segments, field) {
  for (let index = 0; index < segments.length; index++) {
    const current = String(segments[index][field] || '').trim();
    if (!current) continue;
    if (/[.!?,;:]$/.test(current)) {
      segments[index][field] = current;
      continue;
    }
    const next = String(segments[index + 1]?.[field] || '').trim();
    const continua = next && /^[\p{Ll}\d]/u.test(next);
    segments[index][field] = current + (continua ? ',' : '.');
  }
  return segments;
}

/** Aplica normalizacao + pontuacao de continuidade em um campo dos segmentos. */
export function polishForSpeech(segments, field, options = {}) {
  for (const segment of segments) {
    segment[field] = normalizeForSpeech(segment[field], options);
  }
  return addContinuityPunctuation(segments, field);
}
