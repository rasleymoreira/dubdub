# 002 — TypeScript com build por esbuild

**Status:** aceita

## Contexto

O projeto não tinha passo de build. Isso parecia simplicidade, mas cobrava um preço específico:
content scripts declarados no manifest são **scripts clássicos**, sem `import`. Para compartilhar
código entre service worker, content script e popup, existia um namespace global montado por
IIFE (`globalThis.UDUB`), e o manifest carregava cinco arquivos numa ordem que precisava estar
certa.

Sem tipos, o contrato das mensagens entre os três contextos era acordo de cavalheiros: um erro de
digitação em `message.lectureId` virava `undefined` silencioso.

## Decisão

TypeScript em modo estrito, com `esbuild` gerando três bundles:

| Bundle           | Formato | Por quê                                        |
| ---------------- | ------- | ---------------------------------------------- |
| `service-worker` | ESM     | o manifest declara `"type": "module"`          |
| `content`        | IIFE    | content script é script clássico, sem `import` |
| `popup`          | IIFE    | evita depender de `<script type="module">`     |

A saída vai para `build/`, que passa a ser a extensão carregada no Chrome.

Imports usam extensão `.ts` e `allowImportingTsExtensions`. É o que faz `tsc`, `esbuild` e
`node --test` resolverem os mesmos caminhos, sem passo de compilação para rodar teste.

`erasableSyntaxOnly` fica ligado: o test runner do Node executa TypeScript por _type stripping_,
sem gerar código, então parameter properties de construtor quebrariam em tempo de execução. A
flag transforma isso em erro de compilação.

## Consequências

**Ganho.** O namespace global sumiu. O contrato das mensagens é verificado nos dois lados. E o
Chrome deixou de carregar a raiz do repositório — antes ele varria `node_modules/`, os ambientes
Python e os modelos, vários gigabytes que não são parte da extensão.

**Custo.** Existe um passo de build. Quem clona o projeto precisa de `npm install && npm run
build` antes de carregar no Chrome, e depois de cada alteração precisa reconstruir. `npm run
watch` reduz o atrito, mas não elimina.

**Custo pontual.** Como o Chrome deriva o ID de extensão descompactada do caminho, mudar de raiz
para `build/` gera um ID novo — quem já usava precisa registrar o native host de novo.

## Alternativas

**JSDoc com `checkJs`.** Daria tipos sem transpilar, mas não resolve o problema dos ESM em
content script, que era metade da motivação. E tipar interfaces com JSDoc é bem mais verboso.

**Webpack ou Rollup.** Fazem o mesmo. O esbuild constrói os três bundles em ~35 ms, o que torna
o `watch` praticamente instantâneo, e a configuração cabe num arquivo de 120 linhas sem plugin.

**Vite.** Excelente para aplicações web, mas o modelo de dev server não se aplica a uma extensão
que o Chrome carrega do disco.
