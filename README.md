# Udemy Dub PT-BR

Extensão Chrome (MV3) que dubla aulas da Udemy de inglês para português. Você clica em
**Dublar esta aula**, a extensão gera o áudio dublado e, ao dar play no player da Udemy, o
canal de voz original é substituído pela dublagem — sincronizado com `currentTime`,
`playbackRate` (inclusive 1.5x e 2x), pause e seek. Ao terminar, ela continua dublando as
próximas aulas do curso em segundo plano.

## Instalação

1. `chrome://extensions`
2. Ligue o **Modo do desenvolvedor**
3. **Carregar sem compactação** → selecione a pasta `translate-realtime-video`
4. Abra uma aula da Udemy (`.../learn/lecture/...`)

> **Depois de qualquer mudança no `manifest.json`, clique no botão de recarregar da extensão
> em `chrome://extensions`.** O Chrome só relê as permissões (inclusive o acesso a
> `http://localhost`, usado pelo Piper) quando a extensão é recarregada — sem isso a chamada
> ao servidor de voz falha com `Failed to fetch` mesmo com ele no ar.

## Voz: servidor Piper (padrão)

A voz padrão é a **Faber** (`pt_BR-faber-medium`), do Piper — neural, roda na sua máquina,
sem custo e sem limite. Ela precisa do servidor local ligado:

```powershell
.\tools\start-piper.ps1
```

O script cria o `.venv`, instala o `piper-tts`, baixa a voz e sobe o servidor em
`http://localhost:5000`. Deixe a janela aberta enquanto usa a extensão (há também
`tools\start-piper.cmd` para duplo clique). Para outra voz ou porta:
`.\tools\start-piper.ps1 pt_BR-edresson-low 5001`.

### Ligar e desligar pelo popup

Para não deixar o servidor rodando à toa, o popup tem **Ligar servidor** / **Desligar** com
o estado atual (no ar / desligado / porta). Uma extensão não pode iniciar processos sozinha,
então isso passa por um *native messaging host* — um script local que o navegador executa
sob demanda. Registre uma vez:

```powershell
.\tools\install-native-host.ps1
```

Ele descobre o ID da extensão lendo os perfis do Chrome/Edge/Brave, grava
`tools\native-host\com.udub.piper.json` e uma chave em `HKCU` (usuário atual) para cada
navegador instalado. Se a detecção falhar, copie o ID do card em `chrome://extensions` e rode
`.\tools\install-native-host.ps1 -ExtensionId <id>`. Para remover: `-Uninstall`.

Sem esse registro nada quebra — o popup só mostra "controle não instalado" e você segue
subindo o servidor pelo script.

**Trocar de voz não exige reiniciar o servidor**: o `-m` da linha de comando é só o padrão, e
a extensão manda a voz em cada requisição. Basta que o modelo esteja em `models/`.

Fazendo na mão, o equivalente é:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install "piper-tts[http]"
.\.venv\Scripts\python.exe -m piper.download_voices pt_BR-faber-medium --download-dir .\models
.\.venv\Scripts\python.exe -m piper.http_server -m pt_BR-faber-medium --data-dir .\models --port 5000
```

**Use Python 3.11/3.12/3.13.** O `piper-tts` não publica wheel para o 3.14 e o build do
fonte quebra na variante free-threaded (`Py_LIMITED_API` incompatível com `Py_GIL_DISABLED`).

No popup, em *Ajustes*, o botão **Testar** ao lado do endereço confirma a conexão e lista as
vozes instaladas. A extensão também fala com servidores compatíveis com a API da OpenAI
(ex.: `openedai-speech`) — basta apontar a URL para `.../v1/audio/speech`.

Desempenho medido nesta máquina: **~38x mais rápido que tempo real** em CPU (5,89 s de fala
em 154 ms), WAV 22 kHz mono a ~43 KB/s. Uma aula de 1 h (~40 min de fala) leva cerca de
1,5 min para ser dublada e ocupa ~100 MB no cache.

### GPU (CUDA) — medido, e não compensa

Há a opção *Usar GPU (CUDA)* nos ajustes (e `-Cuda` no script), que sobe o servidor com
`--cuda`. Ela vem **desligada**, com motivo medido:

| | mediana para 5,89 s de fala |
|---|---|
| CPU | **154 ms** (38x tempo real) |
| CUDA | 171 ms (34x tempo real) |

Os modelos *medium* do Piper têm 60 MB; a síntese é uma sequência de operações pequenas por
frase, e a ONNX Runtime insere dezenas de nós de cópia CPU↔GPU no grafo. O overhead engole o
ganho — GPU compensa em modelos grandes com lote, não aqui.

Além disso, na prática o CUDA nem chega a rodar em placas Blackwell (RTX 50xx) hoje: o
`onnxruntime-gpu` 1.27+ é buildado com CUDA 13, cujos wheels de Windows ainda não existem no
pip; e a combinação que instala (1.26 + CUDA 12) falha no cuDNN com
`CUDNN_BACKEND_API_FAILED` e cai de volta para CPU sozinha.

Para tentar mesmo assim: `pip install onnxruntime-gpu==1.26.0 nvidia-cudnn-cu12
nvidia-cuda-runtime-cu12 nvidia-cublas-cu12 nvidia-cufft-cu12` (≈1,5 GB) e marque a opção no
popup. O Piper não chama `onnxruntime.preload_dlls()`, então as DLLs do pip só são
encontradas se estiverem no PATH do processo.

Se preferir não instalar nada, troque a voz no popup para **Inworld** (neural, precisa só da
API key) ou **Google TTS** (grátis, voz robótica).

## Voz: Kokoro (local, mais natural que o Piper)

O Piper é VITS de 2023: rápido e visivelmente sintético. O **Kokoro 82M** (Apache-2.0) tem
voz bem mais natural em pt-BR e continua rodando local, de graça. Instale uma vez:

```powershell
py -3.12 -m venv .venv-kokoro
.\.venv-kokoro\Scripts\python.exe -m pip install kokoro soundfile
```

Depois é só escolher **Kokoro (local)** no popup e clicar em **Ligar servidor**. Fora da
extensão, o atalho é o mesmo do Piper:

```powershell
.\tools\start-kokoro.ps1                 # pm_alex na porta 5001
.\tools\start-kokoro.ps1 pf_dora 5001    # outra voz
.\tools\start-kokoro.ps1 -Cuda $true     # usa a GPU, se o torch tiver CUDA
```

Há também `tools\start-kokoro.cmd` para duplo clique. Na primeira execução o script cria o
`.venv-kokoro` e instala o `kokoro`; o modelo (~330 MB) é baixado na primeira síntese.

Vozes em pt-BR: `pm_alex` e `pm_santa` (masculinas), `pf_dora` (feminina).

Medido nesta máquina, com o modelo já carregado: **5,4x tempo real** em CPU (10,9 s de fala
em 2,0 s) — uma aula de 1 h leva ~7 min. Marque *Usar GPU (CUDA)* se instalar o torch com
CUDA; o servidor cai para CPU sozinho se não houver.

> A pronúncia de termos técnicos em inglês no meio do português (`Unreal Engine`, `server`)
> pode variar entre Piper e Kokoro. Vale gerar os dois e comparar no seu curso.

## Voz: F5-TTS (local, clona uma voz)

O **F5-TTS** sintetiza imitando um áudio de referência — você dá 5–15 s de uma voz e ele
dubla naquela voz. Licença **CC-BY-NC-4.0 (uso não comercial)**, checkpoint pt-BR de
[firstpixel/F5-TTS-pt-br](https://huggingface.co/firstpixel/F5-TTS-pt-br).

```powershell
.\tools\install-f5.ps1          # torch com CUDA + f5-tts + checkpoint (~4 GB)
.\tools\install-f5.ps1 -Cpu     # sem GPU (funciona, mas impraticável para aula inteira)
```

Já vem uma referência pronta em `models\f5-ref\padrao.wav` (+ `.txt`), que é a voz padrão
(`f5Voice: 'padrao'`). Para usar outra, coloque um par ao lado:

```
models\f5-ref\minhavoz.wav   5 a 15 s de fala limpa, sem música nem ruído
models\f5-ref\minhavoz.txt   a transcrição exata desse áudio
```

Cada par vira uma "voz" no popup (o botão **Testar** lista as disponíveis). A qualidade da
dublagem depende diretamente da referência: áudio limpo, uma só pessoa falando, sem eco, e o
`.txt` batendo com o áudio palavra por palavra — se divergir, a clonagem degrada.

> Uma forma objetiva de conferir o `.txt`: transcreva o próprio `.wav` (o Deepgram já está
> configurado) e compare com o que você escreveu. Foi assim que a referência `padrao` foi
> validada, com confiança 1.000.

**Precisa de GPU.** Medido nesta máquina (RTX 5070, `torch 2.11.0+cu128`, `nfe_step=32`):

| texto | áudio gerado | tempo | chars/s |
|---|---|---|---|
| 62 chars | 3,43 s | 2,06 s | 18,1 |
| 101 chars | 5,55 s | 2,13 s | 18,2 |
| 55 chars | 3,01 s | 1,93 s | 18,3 |
| 3 chars (`Ok.`) | 0,52 s | 2,08 s | 5,7 |

O custo é **~2 s por trecho, quase independente do tamanho** — o flow matching roda os 32
passos sobre a sequência inteira e recodifica a referência a cada chamada. Ou seja: uma aula
com 400 trechos leva ~13 min, e trechos curtos são o pior negócio. Baixar `--nfe` para 16
corta esse tempo quase pela metade, com risco de mais artefatos.

O ritmo é previsível (18 chars/s nas frases normais), o que ajuda o encaixe no tempo da fala
original.

> **Windows sem FFmpeg:** o `torchaudio` 2.9+ lê áudio via `torchcodec`, que exige as DLLs do
> FFmpeg. O servidor detecta a falha e passa a ler a referência com `soundfile` — nada a
> instalar. Se você tiver FFmpeg, ele usa o caminho nativo.

## Voz: Inworld (sem instalar nada)

Selecione **Inworld** em *Voz da dublagem*. A key já vem preenchida e a voz padrão é a
**Heitor** (masculina, tom neutro). O botão **Testar** lista as vozes em português da conta —
são 14, entre elas Murilo (masculina), Bruna, Renata, Patricia, Tatiana e Vanessa (femininas
brasileiras), além das europeias Matilde, Leonor, Beatriz e Madalena.

Modelos disponíveis, todos verificados: `inworld-tts-2` (padrão, melhor qualidade),
`inworld-tts-2-flash`, `inworld-tts-1` e `inworld-tts-1-max`. O áudio vem em MP3 a 64 kbps
(configurado assim para ocupar metade do padrão sem perda audível), o que dá ~21 MB por aula
de 1 h — cinco vezes menos que o Piper. A cobrança é por caractere processado: uma aula de
1 h consome ~40 mil caracteres.

## Como usar

Tudo pelo **popup da extensão**: dublar, ativar/desativar no player, escolher motores,
idiomas, voz, volumes e gerenciar o cache.

Existe também um painel flutuante dentro da aula (canto inferior direito) com os mesmos
controles principais, mas ele vem **desligado** para não poluir a tela. Se quiser, ligue em
*Ajustes → Mostrar painel flutuante na Udemy*.

A geração começa pelo ponto onde o vídeo está — dá pra dar play e ir ouvindo enquanto o
resto é gerado. Quando termina, a dublagem fica salva: reabrir a aula já toca dublado.

## Como funciona

Pipeline por aula: legendas/transcrição → agrupamento em frases → tradução → TTS por trecho
→ IndexedDB. Cada camada tem cache próprio: trocar a voz não refaz a transcrição, trocar o
idioma não refaz a leitura das legendas.

**Texto original** (escolha no popup):

| Deepgram STT | Legendas Udemy |
|---|---|
| `nova-3` transcrevendo o áudio real do vídeo, com timings precisos | VTT em inglês que a Udemy já fornece, de graça |

**Tradução**: Google Translate (endpoint público, sem key) nos dois casos.

### Preparo do texto antes da voz

Legenda de vídeo vem picada em linhas curtas, muitas vezes sem pontuação e com marcações que
não são fala. Jogar isso direto no sintetizador produz leitura truncada, com entonação de fim
de frase no meio da oração. Antes de sintetizar (e antes de traduzir, o que também melhora a
tradução), o texto passa por `src/background/lib/text.js`:

- quebras de linha viram frase corrida, e palavra cortada no fim da linha é remontada
  (`remote func-\ntion` → `remote function`);
- `[MUSIC]`, `(applause)` e rótulos de locutor (`>> INSTRUCTOR:`) são removidos;
- palavra repetida por falha da legenda automática (`the the server`) é colapsada;
- reticências viram pausa curta, pontuação repetida é normalizada, espaço antes de vírgula
  é corrigido — sem estragar números como `1.500`;
- legenda inteira em caixa alta vira frase normal (senão o TTS soletra);
- **a pausa de quem fala vira vírgula**: se o intervalo entre duas legendas passa de 0,35 s,
  elas são unidas com vírgula em vez de espaço, então o sintetizador respeita o ritmo original;
- todo trecho termina pontuado — vírgula quando a frase continua no trecho seguinte, ponto
  quando termina ali.

**Voz** (escolha no popup):

| Motor | Qualidade pt-BR | Velocidade | Custo | Requisito |
|---|---|---|---|---|
| **Kokoro (local)** | boa, bem mais natural que o Piper | 5,4x tempo real (CPU) | zero | servidor local |
| **Piper (local)** — padrão | robótica, plana | 38x tempo real (CPU) | zero | servidor local |
| **F5-TTS (local)** | clona a voz de uma referência | ~3–5x (GPU) | zero | GPU + referência; **não comercial** |
| **Inworld (Heitor)** | muito boa, neural | ~1,7 s por trecho | por caractere | API key |
| **ElevenLabs** | a melhor | ~1 s por trecho | créditos | API key com plano ativo |
| **Google TTS** | robótica | rápida | zero | nenhum |
| **Deepgram Aura-2** | *não tem português* | rápida | US$ 30/1M chars | usa-se para en/es/de/fr/nl/it/ja |

Cache por aula de 1 h: ~110 MB nos locais (WAV), ~21 MB no Inworld e ~15 MB no ElevenLabs (MP3).

### Reprodução em 1.5x / 2x

O áudio dublado toca em elementos `<audio>` com `preservesPitch`, então acelerar usa o
time-stretch do Chrome e a voz **não fica fina**. A sincronia não é agendada de antemão: a
cada 100 ms a extensão compara onde a dublagem deveria estar (derivado de
`video.currentTime`) com onde ela está e corrige a defasagem. Isso cobre play, pause, seek e
troca de velocidade sem acumular atraso.

Quando a frase traduzida não cabe no espaço até a próxima fala, a voz é comprimida até o
limite de *Aceleração máxima* (padrão 1.25x) — que se soma à velocidade do vídeo. O silêncio
entre as falas conta como espaço útil, então na maioria dos trechos não há compressão nenhuma.

### Adiantar as próximas aulas

Terminada a aula atual, a extensão lê o currículo do curso (API
`subscriber-curriculum-items`, com fallback para o menu lateral), pula as aulas que já têm
dublagem e dubla as **N próximas** (padrão 2, configurável de 0 a 5). Quando você avança, o
áudio já está pronto. O painel mostra `Adiantando: <nome da aula>`. Clicar em *Dublar* na
aula atual interrompe a fila e dá prioridade ao que você está assistindo.

## Limitações reais (importante)

- **Piper precisa do servidor local ligado** (`.\tools\start-piper.ps1`). Sem ele, a
  dublagem falha logo no início com a mensagem e o comando exato para subir — nada é gerado
  à toa. Se o servidor estiver no ar e mesmo assim der `Failed to fetch`, recarregue a
  extensão em `chrome://extensions`.
- **Deepgram não tem voz em português** (só en, es, de, fr, nl, it, ja). Se você escolher
  Aura-2 com destino pt-BR, a extensão avisa e usa o Google TTS na voz, mantendo o Deepgram
  na transcrição.
- **Inworld** cobra por caractere processado (a resposta traz `usage.processedCharactersCount`).
  Antes de começar o job a extensão confere a credencial e se a voz existe no idioma de
  destino, avisando no painel se você escolher uma voz que não fala o idioma.
- **ElevenLabs**: a conta configurada está com **pagamento pendente** — a API responde
  `payment_issue` e restam ~2.000 de 131.000 caracteres. O motor está implementado e testa a
  quota antes de começar, mas só vai funcionar depois de regularizar a assinatura. Referência
  de consumo: uma aula de 1 h gasta ~40.000 caracteres (metade disso no modelo `flash v2.5`).
- **Cursos com DRM** não expõem mp4: nesses casos não há como enviar o áudio ao Deepgram e a
  extensão cai automaticamente para as legendas.
- **Aula sem legenda em inglês e com DRM** não tem como ser dublada — o painel avisa.
- Os endpoints do Google são os públicos (sem key): há throttle, retry com backoff e no
  máximo 2 requisições simultâneas. Em aulas longas pode aparecer 429 esporádico; os trechos
  que falharem são contados no painel e clicar em *Dublar* de novo refaz só o que faltou.
- **Disco**: o Piper devolve WAV (~44 KB/s), então uma aula de 1 h pode passar de 100 MB. Por
  isso o cache guarda no máximo 8 aulas por padrão (ajustável) e descarta as mais antigas. O
  popup mostra o total usado e permite apagar por aula ou tudo.
- A dublagem controla o volume do áudio original enquanto está ativa — use o slider
  *Original* do painel (não o volume da Udemy) para deixar a voz em inglês ao fundo.

## Estrutura

```
manifest.json
icons/                      icones gerados (16/32/48/128)
src/shared/constants.js     namespace comum (mensagens, defaults, vozes, resolveEngines)
src/background/
  service-worker.js         roteador de mensagens, jobs e fila de adiantamento
  lib/pipeline.js           transcricao -> traducao -> voz -> cache (+ preflight, LRU)
  lib/deepgram.js           /v1/listen (nova-3) e /v1/speak (aura-2)
  lib/localtts.js           cliente dos servidores locais (Piper, Kokoro, F5)
  lib/inworld.js            /tts/v1/voice e /tts/v1/voices (mp3 em base64)
  lib/elevenlabs.js         /v1/text-to-speech, vozes e quota
  lib/piper.js              servidor local (3 formatos + compativel com OpenAI)
  lib/google.js             translate_a/single e translate_tts
  lib/segments.js           parser VTT/SRT, agrupamento em frases, chunk de TTS
  lib/text.js               limpeza e pontuacao do texto antes do sintetizador
  lib/db.js                 IndexedDB (transcricoes, traducoes, dublagens, clipes)
  lib/queue.js              concorrencia, retry/backoff, cancelamento
  lib/settings.js           chrome.storage.local com defaults
src/content/
  udemy.js                  ids da aula, API da Udemy, legendas, midia, curriculo
  engine.js                 reproducao sincronizada da dublagem
  overlay.js                painel flutuante em Shadow DOM
  content.js                bootstrap, navegacao SPA, ponte de mensagens
src/popup/                  popup.html / popup.css / popup.js
tools/start-piper.ps1       sobe o servidor do Piper (cria o venv e baixa a voz na 1a vez)
tools/start-piper.cmd       atalho de duplo clique para o script acima
tools/start-kokoro.ps1      sobe o servidor do Kokoro (cria o venv na 1a vez)
tools/start-kokoro.cmd      atalho de duplo clique para o script acima
tools/kokoro_server.py      servidor HTTP do Kokoro no mesmo contrato do Piper
tools/f5_server.py          servidor HTTP do F5-TTS (referencia = voz)
tools/install-f5.ps1        venv, torch com CUDA, f5-tts e checkpoint pt-BR
tools/install-native-host.ps1  registra o controle de ligar/desligar do popup
tools/native-host/host.cjs     host que sobe e mata os servidores locais
tests/local-tts-control.js     testa o host falando o protocolo do navegador
tests/run.js                logica pura + sincronia do player + endpoints reais
tests/udemy-console-check.js  diagnostico para colar no console da aula
.venv/ e models/            ambiente do Piper e a voz baixada (nao versionar)
```

## Testes

```bash
npm test               # tudo (rede + os servidores locais que estiverem no ar)
npm run test:offline   # so logica pura, texto e sincronia do player
npm run test:control   # liga/desliga pelo host: ENGINE=piper|kokoro|f5 (reinicia o servidor!)
DG_KEY=... EL_KEY=... IW_KEY=... KOKORO_URL=http://localhost:5001 npm test
```

A suíte cobre o parser de legendas, o agrupamento em frases, a escolha/fallback de motores e
a matemática de sincronia do player (inclusive os casos de 2x e de compressão de fala).

Para conferir a extração na sua conta da Udemy, abra a aula e cole
`tests/udemy-console-check.js` no console do DevTools: ele imprime courseId, legendas,
media_sources, a lista de aulas e o que seria adiantado.

## Ajustes disponíveis

| Ajuste | Padrão | O que faz |
|---|---|---|
| Texto original | Deepgram STT | ou legendas da Udemy |
| Voz da dublagem | Piper (local) | Kokoro / Piper / F5-TTS / Inworld / ElevenLabs / Google / Deepgram |
| Servidor Kokoro | `http://localhost:5001` | com Ligar/Desligar e teste no popup |
| Voz do Kokoro | `pm_alex` | `pm_santa` (masculina) ou `pf_dora` (feminina) |
| Servidor F5-TTS | `http://localhost:5002` | idem; a "voz" é a referência em `models\f5-ref` |
| Voz do Inworld | `Heitor` | 14 vozes em português, listadas pelo botão Testar |
| Modelo do Inworld | `inworld-tts-2` | ou TTS-2 Flash / TTS-1 / TTS-1 Max |
| Idioma do vídeo / Dublar para | en / pt-BR | também aceita detectar automaticamente |
| Servidor Piper | `http://localhost:5000` | com botão de teste e lista de vozes instaladas |
| Voz do Piper | `pt_BR-faber-medium` | qualquer voz instalada no servidor |
| Volume do áudio original | 0% | 10–20% mantém a voz original ao fundo |
| Volume da dublagem | 100% | |
| Aceleração máxima da voz | 1.25x | limite de compressão para caber no tempo da fala |
| Adiantar próximas aulas | 2 | 0 a 5 |
| Aulas no cache | 8 | descarta as mais antigas |
| Aplicar ao abrir aula dublada | ligado | |
| Dublar automaticamente aulas novas | desligado | |
| Gerar primeiro do ponto atual | ligado | permite ouvir antes de terminar |
| Usar GPU (CUDA) no Piper | desligado | medido: CPU é mais rápida nestes modelos |
| Mostrar painel flutuante | **desligado** | o painel dentro da aula; o popup faz o mesmo |
