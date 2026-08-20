<#
    Prepara o F5-TTS (clonagem de voz zero-shot) em pt-BR.

    Uso:
      .\tools\install-f5.ps1            # torch com CUDA (recomendado)
      .\tools\install-f5.ps1 -Cpu       # torch de CPU (funciona, mas muito lento)

    Cria o .venv-f5, instala o f5-tts e baixa o checkpoint pt-BR
    (firstpixel/F5-TTS-pt-br, licenca CC-BY-NC-4.0 = uso nao comercial).

    Depois disso, coloque a voz de referencia em models\f5-ref\:
      models\f5-ref\minhavoz.wav   5 a 15s de fala limpa
      models\f5-ref\minhavoz.txt   a transcricao exata do audio
#>

param(
    [switch]$Cpu,
    [string]$TorchIndex = 'https://download.pytorch.org/whl/cu128'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv-f5'
$python = Join-Path $venv 'Scripts\python.exe'
$ckptDir = Join-Path $root 'models\f5-pt-br'
$ckpt = Join-Path $ckptDir 'model_last.safetensors'
$refDir = Join-Path $root 'models\f5-ref'
$ckptUrl = 'https://huggingface.co/firstpixel/F5-TTS-pt-br/resolve/main/pt-br/model_last.safetensors'

if (-not (Test-Path $python)) {
    $chosen = $null
    foreach ($version in @('3.12', '3.11', '3.13')) {
        try {
            & py "-$version" --version *> $null
            if ($LASTEXITCODE -eq 0) { $chosen = $version; break }
        } catch { }
    }
    if (-not $chosen) { throw 'Nenhum Python 3.11/3.12/3.13 encontrado.' }
    Write-Host "Criando .venv-f5 com Python $chosen..." -ForegroundColor Cyan
    & py "-$chosen" -m venv $venv
}

if ($Cpu) {
    Write-Host 'Instalando torch (CPU)...' -ForegroundColor Cyan
    & $python -m pip install torch torchaudio --progress-bar off
} else {
    Write-Host "Instalando torch com CUDA de $TorchIndex ..." -ForegroundColor Cyan
    & $python -m pip install torch torchaudio --index-url $TorchIndex --progress-bar off
}

Write-Host 'Instalando f5-tts...' -ForegroundColor Cyan
& $python -m pip install f5-tts --progress-bar off

& $python -c "import torch; print('torch', torch.__version__, '| CUDA:', torch.cuda.is_available())"

if (-not (Test-Path $ckpt)) {
    New-Item -ItemType Directory -Force -Path $ckptDir | Out-Null
    Write-Host 'Baixando o checkpoint pt-BR (~1,3 GB)...' -ForegroundColor Cyan
    $progress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $ckptUrl -OutFile $ckpt
    $ProgressPreference = $progress
}
Write-Host ("checkpoint: {0} ({1:N0} MB)" -f $ckpt, ((Get-Item $ckpt).Length / 1MB)) -ForegroundColor DarkGray

New-Item -ItemType Directory -Force -Path $refDir | Out-Null
$refs = Get-ChildItem $refDir -Filter *.wav -ErrorAction SilentlyContinue
if (-not $refs) {
    Write-Host ''
    Write-Host 'FALTA A VOZ DE REFERENCIA.' -ForegroundColor Yellow
    Write-Host "Coloque em $refDir um par de arquivos:" -ForegroundColor Yellow
    Write-Host '  minhavoz.wav  -> 5 a 15 segundos de fala limpa, sem musica nem ruido' -ForegroundColor Yellow
    Write-Host '  minhavoz.txt  -> a transcricao exata desse audio' -ForegroundColor Yellow
    Write-Host 'O F5 clona essa voz: a qualidade da dublagem depende dela.' -ForegroundColor Yellow
} else {
    foreach ($wav in $refs) {
        $txt = [System.IO.Path]::ChangeExtension($wav.FullName, '.txt')
        $status = if (Test-Path $txt) { 'ok' } else { 'FALTA o .txt com a transcricao' }
        Write-Host "referencia $($wav.BaseName): $status"
    }
}

Write-Host ''
Write-Host 'Pronto. No popup, escolha a voz "F5-TTS (local)" e clique em Ligar servidor.' -ForegroundColor Green
