# DubDub

Extensão Chrome (MV3) que dubla aulas da Udemy para português. Você clica em **Dublar esta
aula**, a extensão gera o áudio e, ao dar play, o canal de voz original é substituído pela
dublagem — sincronizada com `currentTime`, `playbackRate` (inclusive 1.5x e 2x), pause e seek.
Ao terminar, continua dublando as próximas aulas do curso em segundo plano.

Roda com sete motores de voz, três deles locais e sem custo. **Não é preciso nenhuma chave de
API** para usar: legendas da Udemy para o texto, Google Translate para a tradução e Piper,
Kokoro, F5-TTS ou Google TTS para a voz.

## Instalação rápida

```bash
npm install
npm run build
```

Depois, em `chrome://extensions`: ligue o **Modo do desenvolvedor**, clique em **Carregar sem
compactação** e selecione a pasta **`build/`** (não a raiz do projeto).

Para a voz padrão (Piper, local e sem custo), suba o servidor:

```powershell
.\tools\start-piper.ps1
```

Abra uma aula (`.../learn/lecture/...`) e clique em **Dublar esta aula** no popup.

O passo a passo completo, incluindo os outros motores e o controle de ligar/desligar servidor
pelo popup, está em **[docs/INSTALACAO.md](docs/INSTALACAO.md)**.

## Documentação

| Documento                                        | Para quem                                                     |
| ------------------------------------------------ | ------------------------------------------------------------- |
| [docs/INSTALACAO.md](docs/INSTALACAO.md)         | instalar, subir os servidores locais, resolver problemas      |
| [docs/USO.md](docs/USO.md)                       | usar no dia a dia: popup, ajustes, cache, adiantamento        |
| [docs/MOTORES-DE-VOZ.md](docs/MOTORES-DE-VOZ.md) | escolher o motor: qualidade, velocidade medida e custo        |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md)       | como o código é organizado e por quê                          |
| [docs/PADROES.md](docs/PADROES.md)               | padrões de projeto aplicados e o problema que cada um resolve |
| [docs/CONTRIBUINDO.md](docs/CONTRIBUINDO.md)     | build, testes, lint, commits e como adicionar um motor novo   |

## Como funciona

Pipeline por aula, com cache próprio em cada camada:

```
legendas ou transcrição → agrupamento em frases → tradução → TTS por trecho → IndexedDB
```

Trocar a voz não refaz a transcrição; trocar o idioma não refaz a leitura das legendas.

A dublagem toca em elementos `<audio>` com `preservesPitch`: acelerar usa o time-stretch do
Chrome e a voz não fica fina. A cada 100 ms a extensão compara onde a dublagem deveria estar,
derivado de `video.currentTime`, com onde ela está, e corrige — o que cobre play, pause, seek e
troca de velocidade sem acumular atraso.

## Chaves de API

Os campos de credencial nascem **vazios**. Deepgram (transcrição e voz), ElevenLabs e Inworld
são opcionais e você informa a chave no popup, em _Ajustes_. Sem elas a extensão funciona
normalmente com legendas e com os motores locais ou o Google TTS.

> Versões anteriores traziam chaves compartilhadas embutidas no código. Se você usou uma dessas
> versões, a extensão remove essas chaves do seu armazenamento na primeira execução.

## Requisitos

- **Node 22+** para o build (o test runner e o suporte a TypeScript usados aqui são nativos).
- **Python 3.11, 3.12 ou 3.13** para os servidores de voz local. O `piper-tts` não publica wheel
  para o 3.14.
- Windows para os scripts de `tools/` (PowerShell, `taskkill`, `netstat`). O restante do projeto
  é multiplataforma.

## Licença e limites

Os endpoints do Google usados aqui são os públicos, sem chave — há throttle e retry, mas em
aulas longas pode aparecer 429 esporádico. O F5-TTS é **CC-BY-NC-4.0 (uso não comercial)**.
Cursos com DRM não expõem mp4 e caem automaticamente para as legendas; aula sem legenda em
inglês e com DRM não tem como ser dublada.

A lista completa de limitações está em [docs/USO.md](docs/USO.md#limitações-reais).
