# Motores de voz

Sete motores, escolhidos no popup em _Voz da dublagem_. Os números abaixo foram medidos nesta
máquina (RTX 5070) e servem para comparar entre si, não como especificação.

## Comparativo

| Motor                      | Qualidade pt-BR                   | Velocidade            | Custo           | Requisito                           |
| -------------------------- | --------------------------------- | --------------------- | --------------- | ----------------------------------- |
| **Kokoro (local)**         | boa, bem mais natural que o Piper | 5,4x tempo real (CPU) | zero            | servidor local                      |
| **Piper (local)** — padrão | robótica, plana                   | 38x tempo real (CPU)  | zero            | servidor local                      |
| **F5-TTS (local)**         | clona a voz de uma referência     | ~2 s por trecho (GPU) | zero            | GPU + referência; **não comercial** |
| **Inworld**                | muito boa, neural                 | ~1,7 s por trecho     | por caractere   | API key                             |
| **ElevenLabs**             | a melhor                          | ~1 s por trecho       | créditos        | API key com plano ativo             |
| **Google TTS**             | robótica                          | rápida                | zero            | nenhum                              |
| **Deepgram Aura-2**        | _não tem português_               | rápida                | US$ 30/1M chars | usa-se para en/es/de/fr/nl/it/ja    |

Consumo de disco por aula de 1 h: ~110 MB nos locais (WAV), ~21 MB no Inworld e ~15 MB no
ElevenLabs (MP3).

> A pronúncia de termos técnicos em inglês no meio do português (`Unreal Engine`, `server`) varia
> entre os motores. Vale gerar a mesma aula em dois deles e comparar no seu curso.

---

## Piper — o padrão

Voz **Faber** (`pt_BR-faber-medium`): neural, roda na sua máquina, sem custo e sem limite.
Instalação em [INSTALACAO.md](INSTALACAO.md#3-escolher-a-voz).

Medido: **~38x mais rápido que tempo real** em CPU (5,89 s de fala em 154 ms), WAV 22 kHz mono a
~43 KB/s. Uma aula de 1 h (~40 min de fala) leva cerca de 1,5 min e ocupa ~100 MB.

A extensão também fala com servidores compatíveis com a API da OpenAI (ex.: `openedai-speech`) —
basta apontar a URL para `.../v1/audio/speech`.

### GPU (CUDA) — medido, e não compensa

Há a opção _Usar GPU (CUDA)_ nos ajustes (e `-Cuda` no script), que sobe o servidor com `--cuda`.
Ela vem **desligada**, com motivo medido:

|      | mediana para 5,89 s de fala |
| ---- | --------------------------- |
| CPU  | **154 ms** (38x tempo real) |
| CUDA | 171 ms (34x tempo real)     |

Os modelos _medium_ do Piper têm 60 MB; a síntese é uma sequência de operações pequenas por
frase, e a ONNX Runtime insere dezenas de nós de cópia CPU↔GPU no grafo. O overhead engole o
ganho — GPU compensa em modelos grandes com lote, não aqui.

Além disso, na prática o CUDA nem chega a rodar em placas Blackwell (RTX 50xx) hoje: o
`onnxruntime-gpu` 1.27+ é compilado com CUDA 13, cujos wheels de Windows ainda não existem no
pip; e a combinação que instala (1.26 + CUDA 12) falha no cuDNN com `CUDNN_BACKEND_API_FAILED` e
volta para CPU sozinha.

Para tentar mesmo assim:

```powershell
pip install onnxruntime-gpu==1.26.0 nvidia-cudnn-cu12 nvidia-cuda-runtime-cu12 nvidia-cublas-cu12 nvidia-cufft-cu12
```

(≈1,5 GB) e marque a opção no popup. O Piper não chama `onnxruntime.preload_dlls()`, então as
DLLs do pip só são encontradas se estiverem no PATH do processo.

---

## Kokoro — mais natural que o Piper

O Piper é VITS de 2023: rápido e visivelmente sintético. O **Kokoro 82M** (Apache-2.0) tem voz
bem mais natural em pt-BR e continua rodando local, de graça.

```powershell
py -3.12 -m venv .venv-kokoro
.\.venv-kokoro\Scripts\python.exe -m pip install kokoro soundfile
```

Depois escolha **Kokoro (local)** no popup e clique em **Ligar servidor**. Fora da extensão:

```powershell
.\tools\start-kokoro.ps1                 # pm_alex na porta 5001
.\tools\start-kokoro.ps1 pf_dora 5001    # outra voz
.\tools\start-kokoro.ps1 -Cuda $true     # usa a GPU, se o torch tiver CUDA
```

Na primeira execução o script cria o `.venv-kokoro` e instala o `kokoro`; o modelo (~330 MB) é
baixado na primeira síntese.

Vozes em pt-BR: `pm_alex` e `pm_santa` (masculinas), `pf_dora` (feminina).

Medido com o modelo já carregado: **5,4x tempo real** em CPU (10,9 s de fala em 2,0 s) — uma aula
de 1 h leva ~7 min. Marque _Usar GPU (CUDA)_ se instalar o torch com CUDA; o servidor cai para
CPU sozinho se não houver.

---

## F5-TTS — clona uma voz

O **F5-TTS** sintetiza imitando um áudio de referência: você dá 5–15 s de uma voz e ele dubla
naquela voz. Licença **CC-BY-NC-4.0 (uso não comercial)**, checkpoint pt-BR de
[firstpixel/F5-TTS-pt-br](https://huggingface.co/firstpixel/F5-TTS-pt-br).

```powershell
.\tools\install-f5.ps1          # torch com CUDA + f5-tts + checkpoint (~4 GB)
.\tools\install-f5.ps1 -Cpu     # sem GPU (funciona, mas impraticável para aula inteira)
```

Já vem uma referência pronta em `models\f5-ref\padrao.wav` (+ `.txt`), que é a voz padrão. Para
usar outra, coloque um par ao lado:

```
models\f5-ref\minhavoz.wav   5 a 15 s de fala limpa, sem música nem ruído
models\f5-ref\minhavoz.txt   a transcrição exata desse áudio
```

Cada par vira uma "voz" no popup (o botão **Testar** lista as disponíveis). A qualidade depende
diretamente da referência: áudio limpo, uma só pessoa falando, sem eco, e o `.txt` batendo com o
áudio palavra por palavra — se divergir, a clonagem degrada.

> Uma forma objetiva de conferir o `.txt`: transcreva o próprio `.wav` (com o Deepgram, se você
> tiver chave) e compare com o que escreveu. Foi assim que a referência `padrao` foi validada,
> com confiança 1.000.

**Precisa de GPU.** Medido (`torch 2.11.0+cu128`, `nfe_step=32`):

| texto           | áudio gerado | tempo  | chars/s |
| --------------- | ------------ | ------ | ------- |
| 62 chars        | 3,43 s       | 2,06 s | 18,1    |
| 101 chars       | 5,55 s       | 2,13 s | 18,2    |
| 55 chars        | 3,01 s       | 1,93 s | 18,3    |
| 3 chars (`Ok.`) | 0,52 s       | 2,08 s | 5,7     |

O custo é **~2 s por trecho, quase independente do tamanho** — o flow matching roda os 32 passos
sobre a sequência inteira e recodifica a referência a cada chamada. Uma aula com 400 trechos leva
~13 min, e trechos curtos são o pior negócio. Baixar `--nfe` para 16 corta esse tempo quase pela
metade, com risco de mais artefatos.

O ritmo é previsível (18 chars/s nas frases normais), o que ajuda o encaixe no tempo da fala
original.

> **Windows sem FFmpeg:** o `torchaudio` 2.9+ lê áudio via `torchcodec`, que exige as DLLs do
> FFmpeg. O servidor detecta a falha e passa a ler a referência com `soundfile` — nada a
> instalar. Se você tiver FFmpeg, ele usa o caminho nativo.

---

## Inworld — sem instalar nada

Selecione **Inworld** e informe a API key em _Ajustes_. A voz padrão é a **Heitor** (masculina,
tom neutro). O botão **Testar** lista as vozes em português da conta — são 14, entre elas Murilo
(masculina), Bruna, Renata, Patricia, Tatiana e Vanessa (femininas brasileiras), além das
europeias Matilde, Leonor, Beatriz e Madalena.

Modelos disponíveis: `inworld-tts-2` (padrão, melhor qualidade), `inworld-tts-2-flash`,
`inworld-tts-1` e `inworld-tts-1-max`.

O áudio vem em MP3 a 64 kbps (configurado assim para ocupar metade do padrão sem perda audível),
o que dá ~21 MB por aula de 1 h — cinco vezes menos que o Piper. A cobrança é por caractere
processado: uma aula de 1 h consome ~40 mil caracteres.

---

## ElevenLabs

A melhor qualidade em pt-BR, com custo em créditos da conta. Informe a API key em _Ajustes_ e use
**Testar** para ver o saldo e listar as vozes.

Antes de começar um job, a extensão compara o saldo com o tamanho da aula e avisa quando não
cobre. Referência: uma aula de 1 h gasta ~40.000 caracteres (metade disso no modelo
`eleven_flash_v2_5`, que é o padrão).

---

## Google TTS

Sem chave e sem custo, usando o endpoint público do tradutor. Voz robótica, mas é o **fallback**
de toda a extensão: quando falta credencial ou o motor escolhido não tem voz no idioma de
destino, é para cá que a dublagem cai — sempre com um aviso explicando por quê.

O limite de ~200 caracteres por requisição faz um trecho longo virar vários MP3 tocados em
sequência. Como o endpoint é não-oficial, há throttle e retry; a resposta a uma rajada é uma
página de captcha, que a extensão detecta e trata como 429.

---

## Deepgram Aura-2

**Não tem voz em português.** Serve para dublar para inglês, espanhol, alemão, francês, holandês,
italiano ou japonês. Escolhendo Aura-2 com destino pt-BR, a extensão avisa e usa o Google TTS na
voz — mantendo o Deepgram na transcrição, se você tiver chave.

O mesmo provedor faz a transcrição (`nova-3`), que é uma escolha independente da voz: você pode
transcrever com Deepgram e dublar com Kokoro.
