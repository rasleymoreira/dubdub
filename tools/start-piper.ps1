<#
    Sobe o servidor de voz do Piper que a extensao usa.

    Uso:
      .\tools\start-piper.ps1                          # voz Faber na porta 5000
      .\tools\start-piper.ps1 pt_BR-edresson-low 5001  # outra voz / outra porta

    Na primeira execucao cria o .venv, instala o piper-tts e baixa a voz.
    Deixe esta janela aberta enquanto estiver usando a extensao.
#>

param(
    [string]$Voice = 'pt_BR-faber-medium',
    [int]$Port = 5000,
    [bool]$Cuda = $true
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv'
$python = Join-Path $venv 'Scripts\python.exe'
$models = Join-Path $root 'models'

# O piper-tts nao tem wheel para 3.14 (e quebra no build free-threaded).
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
    Write-Host 'Instalando piper-tts (baixa o onnxruntime, demora um pouco)...' -ForegroundColor Cyan
    & $python -m pip install 'piper-tts[http]' --progress-bar off
}

if (-not (Test-Path (Join-Path $models "$Voice.onnx"))) {
    Write-Host "Baixando a voz $Voice..." -ForegroundColor Cyan
    & $python -m piper.download_voices $Voice --download-dir $models
}

$piperArgs = @('-m', 'piper.http_server', '-m', $Voice, '--data-dir', $models, '--port', $Port)
if ($Cuda) { $piperArgs += '--cuda' }

Write-Host ''
Write-Host "Piper no ar em http://localhost:$Port  (voz: $Voice$(if ($Cuda) { ', GPU' } else { ', CPU' }))" -ForegroundColor Green
Write-Host 'Deixe esta janela aberta. Ctrl+C encerra.' -ForegroundColor DarkGray
Write-Host 'Sem GPU? use -Cuda:$false' -ForegroundColor DarkGray
Write-Host ''

& $python @piperArgs
