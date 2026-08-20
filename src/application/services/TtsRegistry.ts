/**
 * Registro dos motores de voz (Abstract Factory).
 *
 * Substitui o switch de sete ramos que existia no pipeline. Quem monta o mapa e
 * o composition root de cada contexto, entao o caso de uso recebe a fabrica e
 * nunca sabe qual implementacao vai atender.
 */

import type { TtsEngineId } from '../../domain/value-objects/EngineId.ts';
import type { SpeechSynthesisPort } from '../ports/SpeechSynthesisPort.ts';

export class TtsRegistry {
  readonly #ports: ReadonlyMap<TtsEngineId, SpeechSynthesisPort>;

  constructor(ports: Iterable<SpeechSynthesisPort>) {
    this.#ports = new Map([...ports].map((port) => [port.engine, port]));
  }

  get(engine: TtsEngineId): SpeechSynthesisPort {
    const port = this.#ports.get(engine);
    if (!port) throw new Error(`motor de voz nao registrado: ${engine}`);
    return port;
  }

  has(engine: TtsEngineId): boolean {
    return this.#ports.has(engine);
  }
}
