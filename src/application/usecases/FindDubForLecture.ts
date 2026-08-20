/**
 * Acha a dublagem que serve para uma aula.
 *
 * Primeiro procura a que casa exatamente com as preferencias atuais. Se nao
 * existe, aceita qualquer dublagem daquela aula que ja tenha algum audio: e
 * melhor tocar a dublagem em Kokoro que o usuario gerou ontem do que mostrar
 * "sem dublagem" so porque hoje o motor selecionado e outro.
 */

import type { Dub } from '../../domain/entities/Dub.ts';
import { DubKey } from '../../domain/value-objects/DubKey.ts';
import type { EngineCapabilityMap } from '../../domain/services/EngineCapabilities.ts';
import type { DubManifest } from '../dto/DubManifest.ts';
import { toManifest } from '../dto/DubManifest.ts';
import type { Settings } from '../dto/Settings.ts';
import type { DubRepository } from '../ports/repositories.ts';
import { selectEngines } from '../services/ResolveEngineSelection.ts';

export interface FindDubForLectureDeps {
  readonly dubs: DubRepository;
  readonly capabilities: EngineCapabilityMap;
}

export class FindDubForLecture {
  private readonly deps: FindDubForLectureDeps;

  constructor(deps: FindDubForLectureDeps) {
    this.deps = deps;
  }

  async execute(lectureId: string, settings: Settings): Promise<DubManifest | null> {
    const selection = selectEngines(settings, this.deps.capabilities);
    const preferred = DubKey.from({
      lectureId,
      targetLang: settings.targetLang,
      ttsEngine: selection.ttsEngine,
      voice: selection.voice
    }).toString();

    const exact = await this.deps.dubs.find(preferred);
    if (exact) return toManifest(exact);

    const candidates = await this.deps.dubs.findByLecture(lectureId);
    const usable = candidates
      .filter((dub) => dub.ready > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    return usable ? toManifest(usable) : null;
  }
}

export class GetDubManifest {
  private readonly dubs: DubRepository;

  constructor(dubs: DubRepository) {
    this.dubs = dubs;
  }

  async execute(key: string): Promise<DubManifest | null> {
    const dub: Dub | null = await this.dubs.find(key);
    return dub ? toManifest(dub) : null;
  }
}
