<#
    Sobe o servidor de voz do Kokoro que a extensao usa.

    Uso:
      .\tools\start-kokoro.ps1                  # voz pm_alex na porta 5001
      .\tools\start-kokoro.ps1 pf_dora 5001     # outra voz
      .\tools\start-kokoro.ps1 -Cuda $true      # usa a GPU (precisa do torch com CUDA)

    Na primeira execucao cria o .venv-kokoro e instala o kokoro; o modelo
    (~330 MB) e baixado na primeira sintese.
    Deixe esta janela aberta enquanto estiver usando a extensao.
#>

param(
    [string]$Voice = 'pm_alex',
    [int]$Port = 5001,
    [bool]$Cuda = $false
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv-kokoro'
$python = Join-Path $venv 'Scripts\python.exe'
$server = Join-Path $root 'tools\kokoro_server.py'

# o kokoro depende de torch, que nao tem wheel para o Python 3.14 free-threaded
$supported = @('3.12', '3.11', '3.13')

if (-not (Test-Path $python)) {
    $chosen = $null
    foreach ($version in $supported) {
        try {
            & py "-$version" --version *> $null
            if ($LASTEXITCODE -eq 0) { $chosen = $version; break }
        } catch { }
    }
    if (-not $chosen) {
        throw "Nenhum Python $($supported -join '/') encontrado. Instale um deles e rode de novo."
    }

    Write-Host "Criando o ambiente com Python $chosen..." -ForegroundColor Cyan
    & py "-$chosen" -m venv $venv
    Write-Host 'Instalando kokoro (baixa o torch, demora um pouco)...' -ForegroundColor Cyan
    & $python -m pip install kokoro soundfile --progress-bar off
}

$serverArgs = @($server, '--port', $Port, '--voice', $Voice)
if ($Cuda) { $serverArgs += @('--device', 'cuda') }

Write-Host ''
Write-Host "Kokoro no ar em http://localhost:$Port  (voz: $Voice$(if ($Cuda) { ', GPU' } else { ', CPU' }))" -ForegroundColor Green
Write-Host 'Deixe esta janela aberta. Ctrl+C encerra.' -ForegroundColor DarkGray
Write-Host 'Vozes em pt-BR: pm_alex, pm_santa (masculinas), pf_dora (feminina)' -ForegroundColor DarkGray
Write-Host ''

$env:PYTHONUTF8 = '1'
& $python @serverArgs
