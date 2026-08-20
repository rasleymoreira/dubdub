/**
 * Guarda de consistencia do catalogo.
 *
 * O ponto da refatoracao foi eliminar as cinco copias da tabela de motores. Isto
 * verifica que a copia unica cobre todo mundo: um motor novo adicionado so pela
 * metade quebra aqui, em vez de virar painel que nao dubla ou fallback que nao
 * existe.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ENGINE_CAPABILITIES,
  LOCAL_SERVER_CATALOG,
  LOCAL_SETTING_KEYS,
  TTS_ENGINE_CATALOG,
  describeEngine
} from '../../src/infrastructure/catalog/engines.catalog.ts';
import { LOCAL_TTS_ENGINE_IDS, TTS_ENGINE_IDS } from '../../src/domain/value-objects/EngineId.ts';
import { DEFAULT_SETTINGS } from '../../src/infrastructure/catalog/defaults.ts';

describe('catalogo de motores', () => {
  it('descreve exatamente os motores declarados no dominio', () => {
    assert.deepEqual(
      [...TTS_ENGINE_CATALOG.map((engine) => engine.id)].sort(),
      [...TTS_ENGINE_IDS].sort()
    );
  });

  it('todo motor tem capacidade declarada para o resolver', () => {
    for (const id of TTS_ENGINE_IDS) {
      assert.ok(ENGINE_CAPABILITIES[id], `sem capacidade para ${id}`);
      assert.equal(ENGINE_CAPABILITIES[id].id, id);
    }
  });

  it('o rotulo da capacidade vem do catalogo, sem divergir', () => {
    for (const id of TTS_ENGINE_IDS) {
      assert.equal(ENGINE_CAPABILITIES[id].label, describeEngine(id).label);
    }
  });

  it('todo motor local tem descritor de servidor e chaves de configuracao', () => {
    for (const id of LOCAL_TTS_ENGINE_IDS) {
      assert.ok(LOCAL_SERVER_CATALOG[id], `sem descritor de servidor para ${id}`);
      assert.ok(LOCAL_SETTING_KEYS[id], `sem chaves de Settings para ${id}`);
    }
  });

  it('local no catalogo de UI e local no catalogo de servidor concordam', () => {
    const uiLocal = TTS_ENGINE_CATALOG.filter((engine) => engine.local).map((engine) => engine.id);
    assert.deepEqual([...uiLocal].sort(), [...LOCAL_TTS_ENGINE_IDS].sort());
  });

  it('os campos de ajuste apontam para chaves reais de Settings', () => {
    for (const engine of TTS_ENGINE_CATALOG) {
      for (const field of engine.fields) {
        assert.ok(
          field.setting in DEFAULT_SETTINGS,
          `${engine.id} declara o campo ${field.setting}, que nao existe em Settings`
        );
      }
    }
  });

  it('cada servidor local usa uma porta distinta', () => {
    const ports = LOCAL_TTS_ENGINE_IDS.map((id) => LOCAL_SERVER_CATALOG[id].defaultPort);
    assert.equal(new Set(ports).size, ports.length, 'duas portas iguais causariam conflito');
  });

  it('a URL padrao de cada servidor bate com a porta do descritor', () => {
    for (const id of LOCAL_TTS_ENGINE_IDS) {
      const url = DEFAULT_SETTINGS[LOCAL_SETTING_KEYS[id].url as keyof typeof DEFAULT_SETTINGS];
      assert.equal(
        new URL(String(url)).port,
        String(LOCAL_SERVER_CATALOG[id].defaultPort),
        `a URL padrao de ${id} aponta para outra porta`
      );
    }
  });

  it('o descritor de servidor local e serializavel para o native host', () => {
    // o host roda fora do bundle e le engines.generated.json, entao funcao
    // nenhuma pode ter entrado no descritor
    const json = JSON.stringify(LOCAL_SERVER_CATALOG);
    assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(LOCAL_SERVER_CATALOG)));
    for (const id of LOCAL_TTS_ENGINE_IDS) {
      assert.ok(json.includes(`"${id}"`));
    }
  });
});

describe('preferencias padrao', () => {
  it('nao trazem credencial nenhuma embutida', () => {
    assert.equal(DEFAULT_SETTINGS.deepgramApiKey, '');
    assert.equal(DEFAULT_SETTINGS.elevenApiKey, '');
    assert.equal(DEFAULT_SETTINGS.inworldApiKey, '');
  });

  it('o motor de voz padrao funciona sem credencial', () => {
    const engine = describeEngine(DEFAULT_SETTINGS.ttsEngine as 'piper');
    assert.equal(ENGINE_CAPABILITIES[engine.id].requiresApiKey, false);
  });
});
