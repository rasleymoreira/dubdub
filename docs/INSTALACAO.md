# Instalação

## 1. Construir a extensão

O projeto é escrito em TypeScript e precisa de um passo de build antes de ser carregado.

```bash
npm install
npm run build
```

Isso gera a pasta `build/`, que é a extensão completa: manifest, ícones, popup e os três
bundles. Durante o desenvolvimento, `npm run watch` reconstrói a cada alteração.

## 2. Carregar no Chrome

1. Abra `chrome://extensions`
2. Ligue o **Modo do desenvolvedor**
3. **Carregar sem compactação** → selecione a pasta **`build/`**
4. Abra uma aula da Udemy (`.../learn/lecture/...`)

> **Selecione `build/`, não a raiz do projeto.** Carregar a raiz faria o Chrome varrer também
> `node_modules/`, os ambientes Python e os modelos baixados — vários gigabytes que não fazem
> parte da extensão.

> **Depois de qualquer mudança no `manifest.json`, clique em recarregar** no card da extensão.
> O Chrome só relê as permissões (inclusive o acesso a `http://localhost`, usado pelos
> servidores de voz) quando a extensão é recarregada. Sem isso a chamada ao servidor falha com
> `Failed to fetch` mesmo com ele no ar.

### Vindo de uma versão anterior

Antes a extensão era carregada da raiz do projeto. Como o Chrome deriva o ID de extensão
descompactada do caminho, mudar para `build/` **gera um ID novo**. Duas consequências:

- Remova a instalação antiga em `chrome://extensions` para não ficar com duas.
- Registre o controle de servidor de novo: `.\tools\install-native-host.ps1`.

O cache de dublagens já gerado é preservado: o formato gravado no IndexedDB não mudou.

## 3. Escolher a voz

A voz padrão é o **Piper**, que roda na sua máquina, sem custo e sem limite. Ele precisa do
servidor local ligado:

```powershell
.\tools\start-piper.ps1
```

O script cria o `.venv`, instala o `piper-tts`, baixa a voz e sobe o servidor em
`http://localhost:5000`. Deixe a janela aberta enquanto usa a extensão (há também
`tools\start-piper.cmd` para duplo clique). Para outra voz ou porta:

```powershell
.\tools\start-piper.ps1 pt_BR-edresson-low 5001
```

Os outros motores, com instalação e comparação de qualidade, estão em
[MOTORES-DE-VOZ.md](MOTORES-DE-VOZ.md).

### Fazendo na mão

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install "piper-tts[http]"
.\.venv\Scripts\python.exe -m piper.download_voices pt_BR-faber-medium --download-dir .\models
.\.venv\Scripts\python.exe -m piper.http_server -m pt_BR-faber-medium --data-dir .\models --port 5000
```

**Use Python 3.11, 3.12 ou 3.13.** O `piper-tts` não publica wheel para o 3.14 e o build a
partir do fonte quebra na variante free-threaded (`Py_LIMITED_API` incompatível com
`Py_GIL_DISABLED`).

## 4. Ligar e desligar o servidor pelo popup

Para não deixar o servidor rodando à toa, o popup tem **Ligar servidor** / **Desligar** com o
estado atual. Uma extensão não pode iniciar processos, então isso passa por um _native
messaging host_ — um script local que o navegador executa sob demanda. Registre uma vez:

```powershell
.\tools\install-native-host.ps1
```

Ele descobre o ID da extensão lendo os perfis do Chrome/Edge/Brave, grava
`tools\native-host\com.udub.piper.json` e uma chave em `HKCU` para cada navegador instalado. Se
a detecção falhar, copie o ID do card em `chrome://extensions` e rode:

```powershell
.\tools\install-native-host.ps1 -ExtensionId <id>
```

Para remover: `-Uninstall`.

Sem esse registro nada quebra — o popup só mostra "controle não instalado" e você sobe o
servidor pelo script.

> O host lê `tools/native-host/engines.generated.json`, que é gerado por `npm run build` a
> partir do catálogo de motores. Se o arquivo não existir, o popup avisa para rodar o build.

**Trocar de voz não exige reiniciar o servidor**: o `-m` da linha de comando é só o padrão, e a
extensão manda a voz em cada requisição. Basta que o modelo esteja em `models/`.

## 5. Chaves de API (opcional)

Os campos de credencial nascem vazios. Informe no popup, em _Ajustes_, só se for usar:

| Provedor       | Para quê                               | Onde obter           |
| -------------- | -------------------------------------- | -------------------- |
| **Deepgram**   | transcrever o áudio real; vozes Aura-2 | console.deepgram.com |
| **ElevenLabs** | melhor voz em pt-BR, por crédito       | elevenlabs.io        |
| **Inworld**    | vozes neurais em pt-BR, por caractere  | inworld.ai           |

O botão **Testar** ao lado de cada campo confirma a credencial e lista o que a conta tem.

## Problemas comuns

| Sintoma                                      | Causa provável e correção                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Failed to fetch` com o servidor no ar       | permissão de `localhost` não recarregada: recarregue a extensão em `chrome://extensions`        |
| "controle não instalado" no popup            | rode `.\tools\install-native-host.ps1`; se falhar, passe `-ExtensionId <id>`                    |
| "catálogo de motores ausente"                | rode `npm run build`: o host lê um arquivo gerado pelo build                                    |
| Piper não sobe                               | Python 3.14 não tem wheel do `piper-tts`; use 3.11, 3.12 ou 3.13                                |
| "Não encontrei legendas nem áudio acessível" | curso com DRM e sem legenda em inglês; ative as legendas no player e tente de novo              |
| A dublagem não toca, mas foi gerada          | clique em **Ativar no player** no popup, ou ligue _Aplicar ao abrir aula já dublada_ em Ajustes |
| O popup mostra "Abra uma aula da Udemy"      | você não está na página do player (a URL precisa conter `/learn/lecture/`)                      |
| F5-TTS lento demais                          | está rodando em CPU; marque _Usar GPU (CUDA)_ e confirme que o torch foi instalado com CUDA     |

Se o servidor local subiu mas não responde, veja o log na raiz do projeto: `piper-server.log`,
`kokoro-server.log` ou `f5-server.log`.
