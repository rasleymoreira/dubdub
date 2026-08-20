# Padrões de projeto aplicados

Todo padrão aqui entrou para resolver um problema concreto que existia no código. Nenhum entrou
por completude de catálogo — aplicar um padrão sem a dor correspondente é
[Speculative Generality](https://refactoring.guru/pt-br/smells/speculative-generality), que é
um code smell, não uma virtude.

A nomenclatura segue o [catálogo do refactoring.guru](https://refactoring.guru/pt-br/design-patterns/catalog).

## Mapa rápido

| Padrão                                                                                            | Onde                               | Smell que eliminou                                 |
| ------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| [Strategy](https://refactoring.guru/pt-br/design-patterns/strategy)                               | `SpeechSynthesisPort` + 5 adapters | Switch Statements de 7 ramos no pipeline           |
| [Strategy](https://refactoring.guru/pt-br/design-patterns/strategy)                               | `tts/protocols/`                   | if/if/if por formato de protocolo                  |
| [Abstract Factory](https://refactoring.guru/pt-br/design-patterns/abstract-factory)               | `TtsRegistry`                      | Shotgun Surgery ao adicionar um motor              |
| [Adapter](https://refactoring.guru/pt-br/design-patterns/adapter)                                 | todo `infrastructure/*Adapter`     | regra de negócio acoplada a `fetch`                |
| Repository                                                                                        | `IndexedDb*Repository`             | Inappropriate Intimacy entre pipeline e banco      |
| [Chain of Responsibility](https://refactoring.guru/pt-br/design-patterns/chain-of-responsibility) | `EngineResolver`                   | cascata de if/else de 64 linhas                    |
| [Chain of Responsibility](https://refactoring.guru/pt-br/design-patterns/chain-of-responsibility) | `BuildTranscript`                  | fallback de fonte de texto aninhado                |
| [Template Method](https://refactoring.guru/pt-br/design-patterns/template-method)                 | `LocalHttpTtsAdapter`              | Duplicate Code entre Piper, Kokoro e F5            |
| [Template Method](https://refactoring.guru/pt-br/design-patterns/template-method)                 | `tools/tts_http_contract.py`       | classe `Handler` duplicada nos servidores Python   |
| [Command](https://refactoring.guru/pt-br/design-patterns/command)                                 | handlers do service worker         | Large Class de 190 linhas de handlers              |
| [Mediator](https://refactoring.guru/pt-br/design-patterns/mediator)                               | `MessageBus`                       | strings soltas entre três contextos, sem contrato  |
| [Observer](https://refactoring.guru/pt-br/design-patterns/observer)                               | `ProgressReporter`                 | Long Parameter List: `emit` repassado por 4 níveis |
| [Decorator](https://refactoring.guru/pt-br/design-patterns/decorator)                             | `withRetry`, `RateLimiter`         | `withRetry` copiado em 5 clientes                  |
| Object Pool                                                                                       | `AudioSlotPool`                    | pool de `<audio>` embutido no player               |
| [Proxy](https://refactoring.guru/pt-br/design-patterns/proxy) (lazy loading)                      | `ClipCache`                        | carregamento sob demanda misturado ao loop de sync |
| [Memento](https://refactoring.guru/pt-br/design-patterns/memento)                                 | `OriginalVolumeGuard`              | Temporary Field: `savedVolume` / `applyingVolume`  |
| [Builder](https://refactoring.guru/pt-br/design-patterns/builder)                                 | `buildDub`                         | objeto de 18 campos montado inline                 |
| [Facade](https://refactoring.guru/pt-br/design-patterns/facade)                                   | casos de uso                       | popup e content falando com o domínio direto       |
| [Flyweight](https://refactoring.guru/pt-br/design-patterns/flyweight)                             | catálogos imutáveis                | catálogo replicado em 5 arquivos                   |
| [Singleton](https://refactoring.guru/pt-br/design-patterns/singleton)                             | `openDatabase`                     | conexão IndexedDB reaberta a cada operação         |

---

## Strategy: motores de voz

**O problema.** O pipeline tinha um `switch` de sete ramos e importava os sete provedores
concretamente. A regra de negócio conhecia Deepgram, ElevenLabs, Inworld, Google e os três
servidores locais pelo nome:

```js
// antes
switch (engines.ttsEngine) {
  case 'deepgram':   return deepgram.speak({ apiKey: settings.deepgramApiKey, ... });
  case 'piper':      return localtts.speak({ baseUrl: settings.piperUrl, ... });
  case 'kokoro':     return localtts.speak({ baseUrl: settings.kokoroUrl, ... });
  // ... mais quatro
}
```

**Agora.** Uma interface, e o registry escolhe:

```ts
export interface SpeechSynthesisPort {
  readonly engine: TtsEngineId;
  readonly concurrency: number;
  speak(request: SynthesisRequest): Promise<AudioClip>;
  preflight?(request: PreflightRequest): Promise<PreflightResult>;
}
```

Repare que `concurrency` é propriedade do adapter. Antes era uma tabela no pipeline
(`TTS_CONCURRENCY = { deepgram: 4, f5: 1, ... }`) — quem sabe o limite de chamadas simultâneas é
quem fala com o serviço, não quem orquestra.

## Chain of Responsibility: escolha do motor

**O problema.** `resolveEngines` tinha 64 linhas de if/else encadeados. Cada regra nova entrava
no meio das outras, e nenhuma podia ser testada isolada. A ordem entre elas era significativa e
implícita.

**Agora.** Nove elos independentes, cada um recebendo a seleção corrente e devolvendo a
ajustada:

```ts
const CHAIN = [
  resolveStt, // auto vira o motor derivado do preset
  sttNeedsCredential, // sem chave do Deepgram, usa legendas
  resolveTts,
  assignVoice,
  voiceMustExistForLanguage, // Deepgram sem voz em pt cai para o Google
  correctVoiceForLanguage, // voz errada para o idioma, mas existe outra
  ttsNeedsCredential, // motor pago sem chave cai para o Google
  warnVoiceLanguageMismatch, // avisa sem trocar
  warnMissingVoiceReference // F5 sem referência escolhida
];
```

A ordem continua importando — idioma antes de credencial, para o aviso mais útil vencer — mas
agora está declarada num lugar só, com o motivo escrito ao lado.

Cada elo é exportado em `RULES` para poder ser exercitado isolado no teste.

## Template Method: os três servidores locais

**No TypeScript.** Piper, Kokoro e F5 falam o mesmo protocolo HTTP; o que varia é URL, rótulo e
a dica de erro. Um adapter atende os três, configurado por descritor.

**No Python.** As classes `Handler` do Kokoro e do F5 eram cópia uma da outra: `_send`, `_json`,
`_audio`, `do_GET` e `do_POST` idênticos. `tools/tts_http_contract.py` ficou com o esqueleto, e
cada servidor implementa só:

```python
class TtsEngine(ABC):
    def synthesize(self, text, voice, speed) -> bytes: ...
    def list_voices(self) -> list: ...
    def describe(self) -> dict: ...
```

## Strategy: protocolos do TTS local

O `piper.http_server` mudou de formato entre versões, e servidores compatíveis com a API da
OpenAI usam outro corpo. Antes isso era um `callMode` com três `if`. Agora cada formato é uma
estratégia, tentadas em ordem, e **o vencedor fica memorizado por URL** — a descoberta é paga
uma vez por servidor, não a cada trecho de uma aula inteira.

## Observer: progresso

**O problema.** A função `emit` era passada por parâmetro através de quatro níveis de chamada
(`startJob` → `runJob` → `buildTranscript` → `translateSegments`), engordando toda assinatura no
caminho — [Long Parameter List](https://refactoring.guru/pt-br/smells/long-parameter-list).

**Agora.** `ProgressReporter` é uma porta. E `withDefaults` resolve elegantemente o caso do
adiantamento, onde cada evento precisa ser carimbado com o título e a posição na fila:

```ts
const reporter = withDefaults(input.reporter, {
  prefetch: true,
  prefetchTitle: label,
  prefetchIndex: completed + 1
});
```

## Memento: volume do vídeo original

Duas coisas tornam isso menos trivial do que parece: a Udemy restaura o volume salvo dela ao
trocar de aula, desfazendo o abaixamento; e reaplicar dispara outro `volumechange`, que sem
distinguir a nossa escrita da do usuário vira laço infinito.

Antes essas duas flags viviam soltas na classe do player, misturadas com sincronia e
carregamento de clipe — [Temporary Field](https://refactoring.guru/pt-br/smells/temporary-field)
clássico. Hoje são o estado inteiro de um objeto que só faz isso.

## Command + Mediator: mensagens

Os handlers do service worker eram um objeto de 190 linhas que também orquestrava jobs e falava
com o native host. Cada mensagem virou um Command registrado no barramento, e o barramento
cuida do que era repetido em cada ponto de envio:

- devolver `true` do listener para manter o canal aberto em resposta assíncrona — quando
  esquecido, a mensagem some sem erro;
- engolir a exceção de aba fechada, que é normal e não merece log;
- embrulhar erro do handler num envelope de falha em vez de rejeitar do outro lado da fronteira.

O contrato é tipado por mensagem, então o TypeScript recusa um `send` com payload errado.

## Fonte única: o catálogo

Não é um padrão GoF, mas é a mudança mais consequente da refatoração. O mesmo motor era descrito
em cinco lugares:

| Antes                           | Onde ficava               |
| ------------------------------- | ------------------------- |
| `TTS_ENGINES` (rótulo, dica)    | constantes compartilhadas |
| `LOCAL_TTS` (URL, porta, voz)   | service worker            |
| `LOCAL_ENGINES` (URL, script)   | pipeline                  |
| `LOCAL_PANELS` (15 ids de DOM)  | popup                     |
| `ENGINES` (venv, args, timeout) | native host               |

Hoje é um descritor por motor em `engines.catalog.ts`, e o resto **deriva**: capacidades para o
resolver de domínio, painéis do popup, adapters do container e o JSON do native host. Um teste
garante que as três visões não divergem.

**Adicionar um motor passou a ser: um adapter e uma entrada no catálogo.** O passo a passo está
em [CONTRIBUINDO.md](CONTRIBUINDO.md#adicionar-um-motor-de-voz).

---

## Padrões deliberadamente não usados

| Padrão         | Por que não                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Visitor        | não há hierarquia de tipos sobre a qual variar operações                                             |
| Composite      | não há estrutura em árvore; segmentos são uma lista plana                                            |
| Bridge         | a variação é de uma dimensão só (o provedor); Strategy já cobre                                      |
| Prototype      | as entidades são imutáveis e criadas por builder; clonar não resolve nada                            |
| State (formal) | o player tem quatro condições de saída, não uma máquina de estados que justifique classes por estado |
| Interpreter    | não há linguagem para interpretar                                                                    |

Aplicar qualquer um deles aqui adicionaria indireção sem remover dor.

## Code smells eliminados

Diagnóstico do código anterior, com a nomenclatura do
[catálogo de smells](https://refactoring.guru/pt-br/refactoring/smells):

| Smell                  | Onde estava                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Switch Statements      | `synthesize()` (7 ramos), `callMode()` (3 formatos)                                |
| Large Class            | popup (658 linhas), player (531), service worker (472)                             |
| Long Method            | `runJob` (145), `bind()` (222), `resolveEngines` (64)                              |
| Duplicate Code         | catálogo em 5 lugares; `readError` em 3 clientes; `Handler` em 2 servidores Python |
| Shotgun Surgery        | adicionar um motor exigia editar 6 arquivos                                        |
| Divergent Change       | `constants.js` mudava por 4 motivos independentes                                  |
| Inappropriate Intimacy | pipeline manipulando `db.STORE` direto; content lendo campos internos do player    |
| Primitive Obsession    | `dubKey` como string `"id\|lang\|engine\|voice"`                                   |
| Long Parameter List    | `runJob` com 7 parâmetros atravessando 4 níveis                                    |
| Data Clumps            | `{apiKey, voiceId, model, text, token}` repetido em todo provedor                  |
| Temporary Field        | `savedVolume`, `applyingVolume`, `pendingManifestKey`                              |
| Feature Envy           | `render()` do content montando estado a partir do player                           |
| Dead Code              | README documentando `lib/piper.js`, arquivo inexistente                            |
