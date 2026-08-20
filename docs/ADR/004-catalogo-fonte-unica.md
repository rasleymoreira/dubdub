# 004 — Catálogo de motores como fonte única

**Status:** aceita

## Contexto

O mesmo motor de voz era descrito em cinco lugares diferentes, cada um com um recorte das
informações:

| Tabela          | Onde ficava               | O que guardava          |
| --------------- | ------------------------- | ----------------------- |
| `TTS_ENGINES`   | constantes compartilhadas | id, rótulo, dica        |
| `LOCAL_TTS`     | service worker            | URL, porta, voz, cuda   |
| `LOCAL_ENGINES` | pipeline                  | URL, rótulo, script     |
| `LOCAL_PANELS`  | popup                     | 15 ids de elementos DOM |
| `ENGINES`       | native host               | venv, args, timeout     |

Adicionar um motor exigia acertar as cinco. Esquecer uma não dava erro: dava painel que aparecia
mas não dublava, ou fallback que o pipeline não sabia atender. É
[Shotgun Surgery](https://refactoring.guru/pt-br/smells/shotgun-surgery) somado a
[Duplicate Code](https://refactoring.guru/pt-br/smells/duplicate-code).

## Decisão

Um descritor por motor em `src/infrastructure/catalog/engines.catalog.ts`. Dele **derivam**:

- as capacidades que o `EngineResolver` do domínio usa para decidir fallbacks;
- os painéis de ajuste do popup, gerados a partir dos campos declarados;
- os adapters montados no composition root;
- `tools/native-host/engines.generated.json`, emitido pelo build e lido pelo native host.

O host precisa de tratamento especial: ele roda como processo Node separado, lançado pelo Chrome,
e não passa pelo bundle — não pode importar TypeScript. Por isso a parte do catálogo que ele
consome é **serializável por construção**: só dados e templates de argumento, nenhuma função. Um
teste verifica isso.

## Consequências

**Ganho.** Adicionar um motor virou: um adapter e uma entrada no catálogo. Um teste de
consistência compara as três visões e falha se alguma peça faltar — o erro aparece em `npm test`,
não como painel mudo em produção.

**Custo.** O catálogo mistura preocupações de camadas diferentes: rótulo de interface, limite de
concorrência, caminho de virtualenv. Isso é deliberado, mas incomoda quem espera separação
estrita. A alternativa seria repartir em três catálogos que precisariam ser mantidos em sincronia
— exatamente o problema que estamos resolvendo.

**Custo.** O native host depende de um arquivo gerado. Sem `npm run build`, ele responde
"catálogo de motores ausente". A mensagem diz o que fazer.

## Alternativas

**Manter as tabelas separadas, com um teste que compara.** Detecta a divergência, mas não impede
que ela aconteça: continua sendo cinco lugares para editar.

**Gerar código em vez de JSON para o host.** Mais complexo, e o host precisa apenas de dados.

**Fazer o host importar o bundle.** Não funciona: o Chrome o lança com o Node do sistema, fora do
contexto da extensão.
