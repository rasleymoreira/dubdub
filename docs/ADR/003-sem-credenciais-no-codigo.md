# 003 — Nenhuma credencial no código

**Status:** aceita

## Contexto

As preferências padrão traziam três chaves de API reais e funcionais embutidas no código-fonte:
Deepgram (transcrição e voz, cobrado por uso), ElevenLabs (créditos) e Inworld (por caractere).
Elas também eram usadas como fallback pela suíte de testes.

Isso funciona enquanto o projeto é de uma pessoa só e nunca sai da máquina dela. Deixa de
funcionar no instante em que o repositório é compartilhado, publicado ou clonado: qualquer pessoa
com o código passa a gastar a conta de quem escreveu, e ninguém percebe até a fatura.

## Decisão

Os campos de credencial nascem **vazios**. O usuário informa a chave no popup, se e quando quiser
usar o motor pago.

A extensão continua útil sem credencial nenhuma: legendas da Udemy para o texto, Google Translate
para a tradução, e Piper, Kokoro, F5-TTS ou Google TTS para a voz. Por isso o preset padrão passou
a ser o que não exige chave.

Uma migração de preferências apaga do armazenamento local as chaves compartilhadas que vieram de
versões anteriores. O reconhecimento é por **prefixo**, não pela chave inteira — reintroduzir a
credencial completa no repositório para poder removê-la seria contraproducente.

## Consequências

**Ganho.** O repositório deixa de vazar credencial. Os testes deixam de gastar cota de terceiros.

**Custo.** Quem usava os motores pagos precisa colar a própria chave uma vez. O popup tem um botão
**Testar** ao lado de cada campo para confirmar na hora.

**Fora do alcance do código.** Remover a chave do repositório **não desfaz a exposição**. As três
credenciais que estavam versionadas precisam ser revogadas nos painéis dos respectivos provedores.
Isso é ação do dono das contas.

## Alternativas

**Arquivo local ignorado pelo git** (`config.local.js` carregado no build). Preserva a conveniência
na máquina de quem desenvolve. Foi descartado porque mantém um caminho em que a chave volta ao
repositório por descuido — basta alguém remover a linha do `.gitignore`.

**Variável de ambiente no build.** Resolve para quem constrói, mas uma extensão não tem ambiente
em tempo de execução: a chave acabaria embutida no bundle de qualquer forma.

**Manter como estava.** Descartado: é justamente o problema.
