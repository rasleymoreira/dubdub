/*
 * Le a pagina da Udemy a partir do service worker, atraves da aba.
 *
 * O worker nao tem DOM nem os cookies da udemy.com, entao quem sabe ler a aula
 * e o content script. Este adapter implementa a mesma porta que os casos de uso
 * ja usam e faz a chamada virar mensagem: para o PrefetchNextLectures nao ha
 * diferenca entre ler a pagina e pedir para alguem ler.
 */

import type { CurriculumItem, Lecture } from '../../domain/entities/Lecture.ts';
import type { LectureSourcePort } from '../../application/ports/LectureSourcePort.ts';
import { MSG } from '../../infrastructure/messaging/contracts.ts';
import type { MessageBus } from '../../infrastructure/messaging/MessageBus.ts';
import { unwrap } from '../../infrastructure/messaging/MessageBus.ts';

export class TabLectureSource implements LectureSourcePort {
  readonly #bus: MessageBus;
  readonly #tabId: number;

  constructor(bus: MessageBus, tabId: number) {
    this.#bus = bus;
    this.#tabId = tabId;
  }

  async getLectureContext(lectureId?: string): Promise<Lecture | null> {
    const response = unwrap(
      await this.#bus.sendToTab(this.#tabId, MSG.GET_LECTURE_CONTEXT, { lectureId })
    );
    return response?.lecture ?? null;
  }

  async getCurriculum(): Promise<CurriculumItem[]> {
    const response = unwrap(await this.#bus.sendToTab(this.#tabId, MSG.GET_CURRICULUM, {}));
    return response ? [...response.items] : [];
  }

  async fetchText(url: string): Promise<string> {
    const response = unwrap(await this.#bus.sendToTab(this.#tabId, MSG.FETCH_TEXT, { url }));
    if (!response) throw new Error('Falha ao baixar pela aba');
    return response.text;
  }
}
