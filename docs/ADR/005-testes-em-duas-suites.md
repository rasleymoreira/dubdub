# 005 — Separar testes unitários de integração

**Status:** aceita

## Contexto

A suíte anterior era um script único que, a cada execução, chamava Google Translate, Google TTS,
Deepgram, ElevenLabs, Inworld e os servidores locais — usando as chaves embutidas no código.

Quatro consequências: era lenta, dependia de internet, gastava cota de contas reais e podia
falhar por motivo completamente alheio ao commit que a disparou. Um teste que falha por motivo
alheio à mudança treina quem o vê a ignorá-lo.

Havia um `--offline`, mas era opt-in: o caminho padrão era o que batia na rede.

## Decisão

Duas suítes, com propósitos distintos, usando o test runner nativo do Node 22:

**`tests/unit/`** — offline, determinística, sem credencial. Cobre domínio, resolução de motores,
geometria de sincronia e casos de uso com fakes. É o que `npm test` roda e o que a CI executa.

**`tests/integration/`** — bate nos serviços de verdade. Cada bloco **pula sozinho** quando falta
a credencial ou o servidor local não está no ar. As chaves entram por variável de ambiente,
nunca por arquivo versionado.

## Consequências

**Ganho.** `npm test` roda em menos de um segundo, sem rede, e uma falha sempre significa que a
mudança quebrou alguma coisa. A CI não precisa de segredo nenhum.

**Ganho.** Os testes de integração continuam existindo e valem mais agora: quando você os roda, é
porque quer saber se o provedor mudou de comportamento — que é a pergunta que eles respondem bem.

**Custo.** Uma regressão que só apareceria contra o serviço real passa pela CI. O risco é aceito:
o que a integração verifica é o contrato de terceiros, que muda sem aviso e independentemente dos
nossos commits.

**Custo.** É preciso lembrar de rodar `npm run test:integration` ao mexer num adapter. O checklist
de verificação manual em [CONTRIBUINDO.md](../CONTRIBUINDO.md#verificação-manual) cobre isso.

## Alternativas

**Gravar e reproduzir respostas HTTP (VCR / nock).** Daria determinismo com cobertura dos
adapters. Ficou de fora por ora: as fixtures envelhecem em silêncio e passam a testar o passado
em vez do contrato atual. Vale reconsiderar se os adapters ganharem mais lógica.

**Manter tudo numa suíte, com flag.** Era o modelo anterior. O problema é o padrão: o caminho
fácil precisa ser o determinístico.
