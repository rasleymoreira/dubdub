# Uso

Tudo pelo **popup da extensão**: dublar, ativar no player, escolher motores, idiomas, voz,
volumes e gerenciar o cache.

Existe também um painel flutuante dentro da aula (canto inferior direito) com os mesmos
controles principais, mas ele vem **desligado** para não poluir a tela. Se quiser, ligue em
_Ajustes → Mostrar painel flutuante na Udemy_.

## O fluxo do dia a dia

1. Abra a aula e clique em **Dublar esta aula**.
2. A geração começa pelo ponto onde o vídeo está — dá para dar play e ir ouvindo enquanto o
   resto é gerado.
3. Quando termina, a dublagem fica salva. Reabrir a aula já toca dublado.
4. Enquanto você assiste, a extensão dubla as próximas aulas do curso em segundo plano.

O botão vira **Cancelar** durante a geração e **Refazer dublagem** depois — refazer aproveita o
que já existe e regenera só o que faltou.

## Estados do indicador

| Cor      | Significado                              |
| -------- | ---------------------------------------- |
| cinza    | sem dublagem para esta aula              |
| amarelo  | gerando (transcrevendo, traduzindo, voz) |
| verde    | dublagem pronta                          |
| roxo     | dublagem ativa no player                 |
| vermelho | erro — a mensagem aparece logo abaixo    |

## Ajustes disponíveis

| Ajuste                             | Padrão                  | O que faz                                                          |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| Texto original                     | Legendas Udemy          | ou Deepgram STT, que transcreve o áudio real                       |
| Voz da dublagem                    | Piper (local)           | Kokoro / Piper / F5-TTS / Inworld / ElevenLabs / Google / Deepgram |
| Idioma do vídeo / Dublar para      | en / pt-BR              | também aceita detectar automaticamente                             |
| Servidor Piper                     | `http://localhost:5000` | com Ligar/Desligar e teste no popup                                |
| Servidor Kokoro                    | `http://localhost:5001` | idem                                                               |
| Servidor F5-TTS                    | `http://localhost:5002` | idem; a "voz" é a referência em `models\f5-ref`                    |
| Volume do áudio original           | 0%                      | 10–20% mantém a voz original ao fundo                              |
| Volume da dublagem                 | 100%                    |                                                                    |
| Aceleração máxima da voz           | 1.25x                   | limite de compressão para caber no tempo da fala                   |
| Adiantar próximas aulas            | 2                       | 0 a 5                                                              |
| Aulas no cache                     | 8                       | descarta as mais antigas                                           |
| Aplicar ao abrir aula dublada      | ligado                  |                                                                    |
| Dublar automaticamente aulas novas | desligado               |                                                                    |
| Gerar primeiro do ponto atual      | ligado                  | permite ouvir antes de terminar                                    |
| Mostrar painel flutuante           | **desligado**           | o popup faz o mesmo sem ocupar a tela                              |

> O volume do áudio original é controlado pela extensão enquanto a dublagem está ativa. Use o
> slider **Volume do áudio original** — não o volume da Udemy, que a extensão sobrescreve.

## Adiantar as próximas aulas

Terminada a aula atual, a extensão lê o currículo do curso (API `subscriber-curriculum-items`,
com fallback para o menu lateral), pula as aulas que já têm dublagem e dubla as **N próximas**
(padrão 2, configurável de 0 a 5). Quando você avança, o áudio já está pronto.

O painel mostra `Adiantando: <nome da aula>`. Clicar em **Dublar** na aula atual interrompe a
fila e dá prioridade ao que você está assistindo.

## Cache

Cada dublagem é identificada por **aula + idioma + motor + voz**. Trocar a voz gera uma dublagem
nova; voltar à voz anterior reaproveita a que já existia.

Consumo por aula de 1 h: **~110 MB** nos motores locais (WAV), **~21 MB** no Inworld e **~15 MB**
no ElevenLabs (MP3). Por isso o cache guarda no máximo 8 aulas por padrão e descarta as mais
antigas. O popup mostra o total em disco e permite apagar por aula ou tudo.

A transcrição e a tradução têm cache próprio e separado: trocar a voz não refaz nenhuma das
duas, e a tradução é reaproveitada entre aulas que repetem a mesma frase.

## Reprodução em 1.5x / 2x

O áudio dublado toca em elementos `<audio>` com `preservesPitch`, então acelerar usa o
time-stretch do Chrome e a voz **não fica fina**.

Quando a frase traduzida não cabe no espaço até a próxima fala, a voz é comprimida até o limite
de _Aceleração máxima_ (padrão 1.25x) — que se soma à velocidade do vídeo. O silêncio entre as
falas conta como espaço útil, então na maioria dos trechos não há compressão nenhuma.

## Preparo do texto antes da voz

Legenda de vídeo vem picada em linhas curtas, muitas vezes sem pontuação e com marcações que não
são fala. Jogar isso direto no sintetizador produz leitura truncada, com entonação de fim de
frase no meio da oração. Antes de sintetizar — e antes de traduzir, o que também melhora a
tradução — o texto passa por um tratamento:

- quebras de linha viram frase corrida, e palavra cortada no fim da linha é remontada
  (`remote func-` + `tion` vira `remote function`);
- `[MUSIC]`, `(applause)` e rótulos de locutor (`>> INSTRUCTOR:`) são removidos;
- palavra repetida por falha da legenda automática (`the the server`) é colapsada;
- reticências viram pausa curta, pontuação repetida é normalizada, espaço antes de vírgula é
  corrigido — sem estragar números como `1.500`;
- legenda inteira em caixa alta vira frase normal (senão o TTS soletra);
- **a pausa de quem fala vira vírgula**: se o intervalo entre duas legendas passa de 0,35 s, elas
  são unidas com vírgula em vez de espaço, então o sintetizador respeita o ritmo original;
- todo trecho termina pontuado — vírgula quando a frase continua no trecho seguinte, ponto quando
  termina ali.

## Limitações reais

- **Os motores locais precisam do servidor ligado.** Sem ele a dublagem falha logo no início, com
  a mensagem e o comando exato para subir — nada é gerado à toa. Se o servidor estiver no ar e
  mesmo assim der `Failed to fetch`, recarregue a extensão em `chrome://extensions`.
- **Deepgram não tem voz em português** (só en, es, de, fr, nl, it, ja). Escolhendo Aura-2 com
  destino pt-BR, a extensão avisa e usa o Google TTS na voz, mantendo o Deepgram na transcrição.
- **Inworld cobra por caractere processado.** Antes de começar, a extensão confere a credencial e
  se a voz existe no idioma de destino.
- **ElevenLabs consome créditos** e verifica a quota antes de iniciar, avisando quando o saldo não
  cobre a aula inteira.
- **Cursos com DRM** não expõem mp4: não há como enviar o áudio ao Deepgram e a extensão cai
  automaticamente para as legendas.
- **Aula sem legenda em inglês e com DRM** não tem como ser dublada — o painel avisa.
- Os endpoints do Google são os públicos, sem chave: há throttle, retry com backoff e no máximo 2
  requisições simultâneas. Em aulas longas pode aparecer 429 esporádico; os trechos que falharem
  são contados no painel e clicar em **Refazer dublagem** regenera só o que faltou.
- Se o Chrome reciclar o service worker durante a geração, o job morre. O painel destrava sozinho,
  carrega o que ficou pronto e **Refazer dublagem** retoma de onde parou.

## Diagnóstico

Para conferir a extração na sua conta da Udemy, abra a aula e cole
`tools/diagnostics/udemy-console-check.js` no console do DevTools: ele imprime courseId,
legendas, `media_sources`, a lista de aulas e o que seria adiantado.
