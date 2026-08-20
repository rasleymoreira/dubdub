/*
 * Leitura de arquivos WebVTT e SRT.
 *
 * Os dois formatos diferem so no separador de milissegundos (`.` contra `,`) e
 * no cabecalho, entao um parser tolerante cobre ambos sem ramificacao.
 */

import type { CaptionCue } from '../entities/Lecture.ts';

function parseTimestamp(raw: string): number | null {
  const value = raw.trim().replace(',', '.');
  const parts = value.split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return parts[0] ?? 0;
}

/** Remove tags de estilo e karaoke e normaliza espacos de uma linha de legenda. */
export function cleanCueText(text: string): string {
  return text
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Devolve as cues cruas em ordem de tempo. */
export function parseCaptions(content: string): CaptionCue[] {
  const lines = String(content).replace(/\r/g, '').split('\n');
  const cues: CaptionCue[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const arrow = line.indexOf('-->');
    if (arrow === -1) {
      index++;
      continue;
    }

    const start = parseTimestamp(line.slice(0, arrow));
    const endRaw =
      line
        .slice(arrow + 3)
        .trim()
        .split(/\s+/)[0] ?? '';
    const end = parseTimestamp(endRaw);
    index++;

    const textLines: string[] = [];
    while (index < lines.length && lines[index]!.trim() !== '') {
      textLines.push(lines[index]!);
      index++;
    }

    const text = cleanCueText(textLines.join(' '));
    if (start !== null && end !== null && end > start && text) cues.push({ start, end, text });
  }

  return cues.sort((a, b) => a.start - b.start);
}

/** Converte cues do player de volta para VTT, para reaproveitar o mesmo parser. */
export function cuesToVtt(cues: readonly CaptionCue[]): string {
  const stamp = (value: number): string => {
    const total = Math.max(0, Number(value) || 0);
    const hours = String(Math.floor(total / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const seconds = String(Math.floor(total % 60)).padStart(2, '0');
    const millis = String(Math.round((total % 1) * 1000)).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${millis}`;
  };

  return cues
    .map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`)
    .join('\n');
}
