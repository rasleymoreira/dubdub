# Arquitetura

O projeto segue **Clean Architecture**: quatro camadas concêntricas, com as dependências
apontando sempre para dentro. A regra é verificada pelo linter, não só por convenção.

```
┌─ presentation ──────────────────────────────────────────┐
│  background/  content/  popup/     (chrome.*, DOM)      │
│  ┌─ infrastructure ─────────────────────────────────┐   │
│  │  tts/ stt/ translation/ persistence/ http/       │   │
│  │  ┌─ application ────────────────────────────┐    │   │
│  │  │  ports/ (interfaces)   usecases/         │    │   │
│  │  │  ┌─ domain ──────────────────────┐       │    │   │
│  │  │  │  entities/  value-objects/    │       │    │   │
│  │  │  │  services/  (regras puras)    │       │    │   │
│  │  │  └───────────────────────────────┘       │    │   │
│  │  └──────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## O que vive em cada camada

### `domain/` — regras que não dependem de nada

Zero I/O, zero `chrome.*`, zero DOM. É a parte que decide o que a extensão **faz**, sem saber
como o mundo funciona.

| Arquivo                       | Responsabilidade                                                     |
| ----------------------------- | -------------------------------------------------------------------- |
| `services/EngineResolver`     | qual motor usar, com fallbacks, quando o pedido não é possível       |
| `services/SpeechTextPolisher` | preparo do texto para a fala: limpeza, pontuação, continuidade       |
| `services/CaptionParser`      | leitura de WebVTT e SRT                                              |
| `services/SegmentGrouper`     | cues curtas viram frases; pausa audível vira vírgula                 |
| `services/TextChunker`        | divisão para caber no limite de requisição do provedor               |
| `services/PlaybackGeometry`   | matemática da sincronia: compressão, posição no clipe, busca binária |
| `services/SynthesisOrder`     | ordem de geração, começando pelo ponto onde o vídeo está             |
| `entities/`                   | `Dub`, `Segment`, `Transcript`, `Lecture`, `AudioClip`, `JobStatus`  |
| `value-objects/`              | `DubKey`, `LanguageCode`, `TimeRange`, `EngineId`, `TextHash`        |

Tudo aqui é função pura ou dado imutável. É também onde está a maior parte dos testes: 98 casos
rodam sem stub de navegador nenhum.

### `application/` — casos de uso e portas

Declara **o que o sistema precisa do mundo** (portas, que são interfaces) e orquestra as etapas.
Não sabe que existe Deepgram, IndexedDB ou `fetch`.

```
ports/                              usecases/
  SpeechSynthesisPort                 DubLecture          orquestra as três etapas
  TranscriptionPort                   BuildTranscript     texto original, com cadeia de fallback
  TranslationPort                     TranslateSegments   tradução com cache por texto
  DubRepository, ClipRepository...    SynthesizeSegments  voz trecho a trecho
  LectureSourcePort                   PrefetchNextLectures
  LocalServerControlPort              RunDubJob           ciclo de vida do job
  ProgressReporter, Logger, Clock     EnforceCacheLimit, ListDubs, ...
```

`DubLecture` é deliberadamente magro: decide a **ordem** das etapas e nada mais.

### `infrastructure/` — os adapters

Implementa as portas falando com o mundo real.

| Pasta          | O que tem                                                         |
| -------------- | ----------------------------------------------------------------- |
| `catalog/`     | **fonte única** dos motores, vozes, idiomas e preferências padrão |
| `tts/`         | um adapter por provedor; os três locais compartilham um só        |
| `stt/`         | Deepgram (áudio real) e legendas da Udemy                         |
| `translation/` | Google Translate                                                  |
| `persistence/` | repositórios IndexedDB e preferências em `chrome.storage`         |
| `http/`        | cliente HTTP, retry com backoff, rate limiter                     |
| `messaging/`   | barramento e contrato tipado das mensagens                        |
| `native/`      | controle dos servidores locais via native messaging               |

### `presentation/` — os três contextos do Chrome

| Contexto           | Ponto de entrada               | Papel                                 |
| ------------------ | ------------------------------ | ------------------------------------- |
| **service worker** | `background/service-worker.ts` | roteia mensagens, executa os jobs     |
| **content script** | `content/content-main.ts`      | lê a página da Udemy, toca a dublagem |
| **popup**          | `popup/popup-main.ts`          | interface de controle                 |

Cada um tem seu _composition root_ — o único lugar onde as camadas se encontram e as portas
recebem seus adapters. `background/container.ts` é o maior deles.

## Fluxo de uma dublagem

```
  popup                service worker                    content script
    │                        │                                 │
    │── START_JOB ──────────▶│                                 │
    │                        │── GET_LECTURE_CONTEXT ─────────▶│
    │                        │◀──────────── Lecture ───────────│  lê API da Udemy
    │                        │                                 │
    │                   DubLecture                              │
    │                        ├─ BuildTranscript ────────────────┼─▶ Deepgram ou legendas
    │                        ├─ TranslateSegments ──────────────┼─▶ Google Translate
    │                        └─ SynthesizeSegments ─────────────┼─▶ TTS escolhido
    │                        │        (grava no IndexedDB)      │
    │◀── JOB_PROGRESS ───────┼──── JOB_PROGRESS ──────────────▶│  a cada trecho
    │                        │── DUB_READY (manifesto) ───────▶│
    │                        │                                 │
    │                        │◀── GET_CLIPS (sob demanda) ──────│  o player pede o áudio
    │                        │─── clipes em base64 ───────────▶│
    │                   PrefetchNextLectures                    │
```

O **manifesto** que vai para o player tem só tempos e textos. O áudio vem depois, em lotes de
oito, conforme o vídeo avança: uma aula de 1 h passa de 100 MB e não caberia numa mensagem.

## Decisões que explicam a forma do código

### Por que o áudio trafega em base64

As mensagens do `chrome.runtime` são serializadas em JSON. Binário não atravessa a fronteira
entre o service worker e o content script, então os clipes são armazenados e transmitidos em
base64, com o custo de ~33% de overhead.

### Por que a sincronia é por polling, e não agendada

A cada 100 ms o player compara onde a dublagem deveria estar com onde está. Um agendamento
prévio teria de ser refeito a cada play, pause, seek e mudança de velocidade; a comparação
periódica cobre os quatro sem tratamento especial e sem acumular atraso.

### Por que `<audio>` e não Web Audio API

O elemento tem `preservesPitch`. Acelerar a fala para acompanhar um vídeo em 2x usa o
time-stretch do Chrome e a voz não fica fina. Com `AudioBufferSourceNode` isso teria de ser
implementado à mão.

### Por que o catálogo de motores é fonte única

Antes o mesmo motor era descrito em cinco lugares: constantes compartilhadas, service worker,
pipeline, popup e o native host. Adicionar um motor exigia acertar os cinco, e esquecer um dava
bug silencioso. Hoje `infrastructure/catalog/engines.catalog.ts` descreve cada motor uma vez, e
dele derivam as capacidades do domínio, os painéis do popup e o JSON que o host lê.

### Por que o native host lê um JSON gerado

Ele roda como processo Node separado, lançado pelo Chrome, e não passa pelo bundle — não pode
importar TypeScript. `npm run build` exporta o catálogo para
`tools/native-host/engines.generated.json`, que é o que ele consome.

### Por que o formato gravado no disco é o antigo

Os nomes curtos (`src`, `txt`, `i`) se repetem uma vez por trecho, e são milhares. Mais
importante: manter o formato custa uma função de mapeamento no repositório, enquanto quebrá-lo
custaria ao usuário até oito aulas já sintetizadas.

### Por que o `build/` é a extensão, e não a raiz

Carregar a raiz faria o Chrome varrer `node_modules/`, os ambientes Python e os modelos —
gigabytes que não são parte da extensão. `build/` contém exatamente o que roda.

## A barreira de camada

O ESLint recusa imports que apontem para fora:

```js
// src/domain/qualquer-coisa.ts
import type { Settings } from '../application/dto/Settings.ts';
//     ^ erro: domain nao pode depender de camadas externas
```

Também bloqueia globais de plataforma em `domain/` e `application/`: `chrome`, `fetch`,
`document`, `window`, `indexedDB`, `localStorage`. Se um caso de uso precisa de algo do mundo,
o caminho é declarar uma porta.

Sem essa barreira mecânica a arquitetura se degrada em silêncio — basta um import "só dessa vez".
