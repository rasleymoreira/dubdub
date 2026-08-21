# Contribuindo

## Setup

```bash
npm install
npm run build
```

Carregue a pasta `build/` em `chrome://extensions` (Modo do desenvolvedor → Carregar sem
compactação). Detalhes e problemas comuns em [INSTALACAO.md](INSTALACAO.md).

Durante o desenvolvimento:

```bash
npm run watch    # reconstrói a cada alteração
```

O `watch` reconstrói os bundles, mas o Chrome não recarrega sozinho. Depois de cada build,
clique em recarregar no card da extensão — ou, para mudanças só no content script, recarregue a
aba da Udemy.

## Scripts

| Comando                    | O que faz                                                          |
| -------------------------- | ------------------------------------------------------------------ |
| `npm run build`            | gera `build/` e `tools/native-host/engines.generated.json`         |
| `npm run watch`            | build incremental com sourcemap                                    |
| `npm run typecheck`        | `tsc --noEmit` em modo estrito                                     |
| `npm run lint`             | ESLint, incluindo as regras de fronteira de camada                 |
| `npm run lint:fix`         | corrige o que dá para corrigir sozinho                             |
| `npm run format`           | Prettier                                                           |
| `npm test`                 | testes unitários (offline, determinísticos)                        |
| `npm run test:integration` | testes que batem em rede e nos servidores locais                   |
| `npm run test:control`     | liga/desliga o servidor pelo native host — **reinicia o servidor** |
| `npm run verify`           | lint + typecheck + testes + build, nesta ordem                     |

**Rode `npm run verify` antes de abrir um PR.** É o que a CI executa.

## Ícones

A arte original de 512x512 fica em `assets/icon.png`, fora de `icons/` porque o build copia
`icons/` inteiro para dentro da extensão e o arquivo de origem não precisa ser distribuído.

Para trocar o ícone, substitua `assets/icon.png` e rode:

```powershell
.\tools\generate-icons.ps1
```

O script reamostra os quatro tamanhos que o `manifest.json` declara — 16, 32, 48 e 128 — com
bicúbica de alta qualidade e transparência preservada. Confira o resultado em **16px**: é o
tamanho que aparece na barra do Chrome e o primeiro a perder legibilidade. Arte com muitos
elementos separados vira um borrão nesse tamanho.

O popup usa `icons/icon128.png` renderizado a 28px no cabeçalho, então o logo ao lado do título
e o ícone da barra são sempre o mesmo arquivo.

## Testes

Duas suítes, com propósitos diferentes:

**`tests/unit/`** — roda offline, é determinística e cobre o domínio, a resolução de motores, a
geometria de sincronia e os casos de uso com fakes. É a que a CI executa e a que precisa passar
sempre.

**`tests/integration/`** — bate em Google, Deepgram, ElevenLabs, Inworld e nos servidores locais
de verdade. **Pula sozinha** quando falta a credencial ou o servidor não está no ar:

```bash
npm run test:integration
DG_KEY=... EL_KEY=... IW_KEY=... npm run test:integration
PIPER_URL=http://localhost:5000 npm run test:integration
```

Nunca coloque credencial em arquivo versionado — as chaves entram por variável de ambiente.

O test runner é o nativo do Node 22, que executa TypeScript por _type stripping_: ele remove os
tipos sem gerar código. Isso tem uma consequência prática:

> **Não use parameter properties de construtor** (`constructor(private readonly x: T)`). Elas
> exigem geração de código e quebram em tempo de execução. O `tsconfig.json` liga
> `erasableSyntaxOnly`, então isso vira erro de compilação em vez de surpresa no teste. Declare
> o campo e atribua no corpo do construtor.

## Regras de camada

O ESLint recusa import que aponte para fora da camada:

- `domain/` não importa `application/`, `infrastructure/` nem `presentation/`
- `application/` só importa `domain/`
- `infrastructure/` não importa `presentation/`

`domain/` e `application/` também não podem tocar em `chrome`, `fetch`, `document`, `window`,
`indexedDB` ou `localStorage`. Se um caso de uso precisa de algo do mundo, o caminho é **declarar
uma porta** em `application/ports/` e implementá-la em `infrastructure/`.

Convenções que o linter não pega, mas revisão pega:

- Imports usam extensão `.ts` (é o que faz `tsc`, `esbuild` e `node --test` concordarem).
- Nada de `console` fora de `infrastructure/logging/`; injete a porta `Logger`.
- Texto de interface fica na camada de apresentação sempre que possível; erros de domínio
  carregam dado estruturado, não frase pronta.
- Interface se constrói com nós do DOM (`views/dom.ts`), não com concatenação de HTML.

## Adicionar um motor de voz

Antes exigia editar seis arquivos. Hoje são dois passos.

### 1. O adapter

`src/infrastructure/tts/MeuMotorTtsAdapter.ts`, implementando `SpeechSynthesisPort`:

```ts
export class MeuMotorTtsAdapter implements SpeechSynthesisPort {
  readonly engine = 'meumotor' as const;
  readonly concurrency = 3;

  async speak(request: SynthesisRequest): Promise<AudioClip> {
    // ...
    return { parts: [base64], mime: 'audio/mpeg' };
  }

  // opcional: falha cedo, antes de o usuário esperar por uma aula inteira
  async preflight(request: PreflightRequest): Promise<PreflightResult> {
    return { notes: [] };
  }
}
```

### 2. O catálogo

Em `src/domain/value-objects/EngineId.ts`, acrescente o id em `TTS_ENGINE_IDS`.

Em `src/infrastructure/catalog/engines.catalog.ts`:

```ts
// em TTS_ENGINE_CATALOG
{
  id: 'meumotor',
  label: 'Meu Motor',
  hint: 'Uma frase dizendo o compromisso: qualidade, velocidade, custo.',
  local: false,
  concurrency: 3,
  fields: [
    { setting: 'meuMotorApiKey', label: 'API key', kind: 'password' },
    { setting: 'meuMotorVoiceId', label: 'Voz', kind: 'select' }
  ]
}

// em ENGINE_CAPABILITIES
meumotor: capability('meumotor', { requiresApiKey: true })
```

Acrescente os campos declarados em `fields` ao tipo `Settings` e a `DEFAULT_SETTINGS` — **com
credencial vazia**.

Por fim, registre o adapter em `presentation/background/container.ts`.

O painel do popup aparece sozinho, com os campos declarados e o botão Testar. `npm test` avisa se
faltou alguma peça: há um teste de consistência que compara as três visões do catálogo.

## Adicionar uma mensagem entre contextos

1. Acrescente o nome em `MSG`, em `infrastructure/messaging/contracts.ts`.
2. Declare `request` e `response` em `MessageContracts`.
3. Registre o handler com `bus.on(MSG.X, ...)` no contexto que atende.
4. Chame com `bus.send(...)` ou `bus.sendToTab(...)` no contexto que pede.

O tipo do payload é verificado nos dois lados.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/pt-br/):

```
<tipo>: <título no imperativo, sem ponto final>

<corpo explicando por que a mudança foi feita, qual problema ela resolve
e o que muda para quem usa. Uma a três frases curtas.>
```

Tipos: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `style`, `build`, `ci`.

O corpo importa mais que o título. O título diz o que mudou; o corpo diz por quê — é o que
alguém vai querer saber daqui a seis meses.

## Branches

```
<tipo>/<slug_em_snake_case>
```

Exemplos: `feat/adicionar_motor_azure`, `fix/sincronia_apos_seek`,
`refactor/extrair_cache_de_clipes`.

Nunca trabalhe direto na `main`.

## Pull request

Título igual ao do commit principal. Corpo com três seções:

- **Resumo** — o que muda e por quê
- **Mudanças** — os pontos principais, em lista
- **Plano de teste** — o que você executou, incluindo o teste manual no Chrome

Não abra PR com `npm run verify` falhando, a menos que esteja explicitamente marcado como WIP.

## Verificação manual

Os testes não cobrem a integração com o Chrome nem com a Udemy. Antes de considerar uma mudança
pronta:

1. `chrome://extensions` → recarregar → console do service worker sem erro
2. Abrir uma aula → o popup mostra o título dela
3. Dublar com **Piper** (local, sem custo) → o áudio toca sincronizado
4. Testar 1.5x e 2x → a voz acompanha sem ficar fina
5. Dar seek para o meio → a dublagem reengata no trecho certo
6. Trocar para **Kokoro** → confirmar que o cache separa por motor
7. Sem chave de API configurada → os motores pagos avisam e caem para legendas/Google
8. Ligar/desligar servidor pelo popup → o native host responde
9. Avançar de aula → o adiantamento já deixou pronta

## Estrutura de diretórios

```
manifest.json              copiado para build/ na íntegra
scripts/build.mjs          esbuild: 3 bundles + assets + catálogo do host

src/
  domain/                  regras puras, sem I/O
  application/             portas e casos de uso
  infrastructure/          adapters: HTTP, IndexedDB, mensagens, catálogo
  presentation/            service worker, content script, popup

tests/
  unit/                    offline, determinístico, roda na CI
  integration/             rede e servidores locais, opt-in
  fixtures/                dados compartilhados

tools/
  tts_http_contract.py     esqueleto HTTP compartilhado (Template Method)
  kokoro_server.py         servidor do Kokoro
  f5_server.py             servidor do F5-TTS
  native-host/host.cjs     liga e desliga os servidores locais
  diagnostics/             script para colar no console da Udemy
  *.ps1 / *.cmd            instalação e atalhos (Windows)

docs/                      esta documentação
build/                     saída do build; é o que o Chrome carrega
```
