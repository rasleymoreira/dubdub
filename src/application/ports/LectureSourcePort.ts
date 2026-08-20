/**
 * Porta de leitura da pagina da Udemy.
 *
 * A implementacao roda no content script, porque a API interna da Udemy exige
 * os cookies e o Referer da propria pagina. Do ponto de vista do service
 * worker isso e uma chamada assincrona qualquer.
 *
 * Concentrar aqui tudo que sabe do HTML e da API da Udemy e proposital: e a
 * parte que mais quebra quando a Udemy muda o site, e o resto do sistema nao
 * deve sentir.
 */

import type { CurriculumItem, Lecture } from '../../domain/entities/Lecture.ts';

export interface LectureSourcePort {
  /** Sem argumento le a aula aberta; com id le outra aula do mesmo curso. */
  getLectureContext(lectureId?: string): Promise<Lecture | null>;
  getCurriculum(): Promise<CurriculumItem[]>;
  /** Baixa um texto usando os cookies da aba (fallback de CORS nas legendas). */
  fetchText(url: string): Promise<string>;
}
