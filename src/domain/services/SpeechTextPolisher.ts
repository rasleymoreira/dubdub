/*
 * Preparo do texto antes do sintetizador.
 *
 * Legenda de video vem picada em linhas curtas, muitas vezes sem pontuacao e
 * com marcacoes que nao sao fala ([MUSIC], ">> INSTRUCTOR:"). Jogar isso direto
 * no TTS produz leitura truncada, com entonacao de fim de frase no meio da
 * oracao. Aqui o texto vira frase corrida e pontuada.
 *
 * Todas as funcoes sao puras. A versao anterior alterava o array recebido
 * (`polishForSpeech(segments, 'txt')` mutava in-place), o que tornava a ordem
 * das chamadas significativa e escondia efeito colateral numa funcao de
 * aparencia inofensiva.
 */

const NON_SPEECH =
  /^(music|musica|música|applause|aplausos|laughter|risos|silence|silencio|silêncio|inaudible|inaudivel|inaudível|sound|som|noise|ruido|ruído)[\s.!]*$/i;

const SENTENCE_END = /[.!?]$/;

/** Marcadores de nao-fala entre colchetes ou parenteses. */
function stripNonSpeech(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(([^)]*)\)/g, (full, inner: string) => (NON_SPEECH.test(inner.trim()) ? ' ' : full));
}

/** ">> JOHN:" / "INSTRUCTOR:" no inicio da fala. */
function stripSpeakerLabel(text: string): string {
  return text
    .replace(/^\s*>>+\s*/, '')
    .replace(/^\s*[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ .'-]{1,24}:\s+/, '');
}

/** Legenda inteira em caixa alta faz o TTS soletrar: vira frase normal. */
function fixShouting(text: string): string {
  if (text.length < 12) return text;
  if (/[a-zà-ÿ]/.test(text)) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export interface NormalizeOptions {
  /**
   * Remove palavras repetidas em sequencia ("the the server"), artefato de
   * legenda automatica. So no texto de origem: no traduzido a repeticao pode
   * ser intencional.
   */
  readonly dedupe?: boolean;
  /**
   * Capitaliza a primeira letra. Ligado por padrao para uso avulso, mas
   * `polishForSpeech` desliga: a capitalizacao precisa acontecer DEPOIS de
   * decidir a continuidade entre trechos, nunca antes. Veja o comentario la.
   */
  readonly capitalize?: boolean;
}

export function normalizeForSpeech(text: string, options: NormalizeOptions = {}): string {
  let out = String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\u00a0/g, ' ');

  out = stripNonSpeech(out);
  out = stripSpeakerLabel(out);

  out = out
    // palavra cortada pela quebra de linha: "exem- plo" -> "exemplo"
    .replace(/(\p{L})-\s+(\p{L})/gu, '$1$2')
    // travessao ou bullet no inicio
    .replace(/^\s*[-–—•*]\s+/, '')
    // reticencias viram pausa curta em vez de suspense
    .replace(/\s*\.{3,}\s*/g, ', ')
    .replace(/\s*…\s*/g, ', ')
    // pontuacao repetida
    .replace(/([.!?])\1{1,}/g, '$1')
    // espaco antes da pontuacao
    .replace(/\s+([,.;:!?])/g, '$1')
    // pontuacao colada na palavra seguinte, sem estragar numeros como 1.500
    .replace(/([,;:])(?=\S)/g, '$1 ')
    .replace(/([.!?])(?=\p{Lu})/gu, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (options.dedupe) {
    out = out.replace(/\b(\p{L}{2,})(\s+\1\b)+/giu, '$1');
  }

  out = fixShouting(out);
  return options.capitalize === false ? out : capitalizeFirst(out);
}

/**
 * Garante que todo trecho termine pontuado. Sem isso o sintetizador le a ultima
 * palavra com entonacao suspensa. Virgula quando a frase continua no trecho
 * seguinte, ponto quando termina ali.
 *
 * A continuidade e deduzida da caixa do trecho seguinte: comecar em minuscula
 * ou digito significa que a oracao vinha de tras. Por isso esta funcao PRECISA
 * rodar sobre texto ainda nao capitalizado.
 */
export function addContinuityPunctuation(texts: readonly string[]): string[] {
  return texts.map((raw, index) => {
    const current = String(raw ?? '').trim();
    if (!current) return current;
    if (/[.!?,;:]$/.test(current)) return current;

    const next = String(texts[index + 1] ?? '').trim();
    const continues = next.length > 0 && /^[\p{Ll}\d]/u.test(next);
    return current + (continues ? ',' : '.');
  });
}

/**
 * Capitaliza so quem realmente comeca frase: o primeiro trecho e todo trecho
 * logo depois de um que fechou com ponto final. Quem continua a oracao anterior
 * segue em minuscula, que e como o sintetizador entende que nao deve reiniciar
 * a entonacao.
 */
export function capitalizeSentenceStarts(texts: readonly string[]): string[] {
  return texts.map((text, index) => {
    if (index === 0) return capitalizeFirst(text);
    const previous = String(texts[index - 1] ?? '').trim();
    return SENTENCE_END.test(previous) ? capitalizeFirst(text) : text;
  });
}

/**
 * Normalizacao + pontuacao de continuidade + capitalizacao, nesta ordem.
 *
 * A ordem e o ponto todo desta funcao. Na versao anterior a capitalizacao
 * acontecia dentro de `normalizeForSpeech`, ou seja, ANTES da continuidade: o
 * proximo trecho ja chegava com maiuscula, o teste de "comeca em minuscula"
 * nunca dava verdadeiro e todo trecho terminava em ponto. A virgula de
 * continuidade estava escrita, comentada e testada, mas nunca acontecia no
 * pipeline real.
 */
export function polishForSpeech(texts: readonly string[], options: NormalizeOptions = {}): string[] {
  const normalized = texts.map((text) =>
    normalizeForSpeech(text, { ...options, capitalize: false })
  );
  return capitalizeSentenceStarts(addContinuityPunctuation(normalized));
}
