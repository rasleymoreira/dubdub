<#
    Sobe o servidor de voz do F5-TTS que a extensao usa.

    Uso:
      .\tools\start-f5.ps1                     # referencia padrao na porta 5002
      .\tools\start-f5.ps1 minhavoz 5002       # outra referencia
      .\tools\start-f5.ps1 -Cuda $false        # forca CPU (fica lento)
      .\tools\start-f5.ps1 -Nfe 16             # metade dos passos: ~2x mais rapido

    O ambiente e o checkpoint sao preparados por tools\install-f5.ps1 (rode uma
    vez antes). Deixe esta janela aberta enquanto estiver usando a extensao.
#>

param(
    [string]$Voice = 'padrao',
    [int]$Port = 5002,
    [bool]$Cuda = $true,
    [int]$Nfe = 32
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv-f5'
$python = Join-Path $venv 'Scripts\python.exe'
$server = Join-Path $root 'tools\f5_server.py'
$ckpt = Join-Path $root 'models\f5-pt-br\model_last.safetensors'
$refDir = Join-Path $root 'models\f5-ref'

# o F5 e pesado (torch + checkpoint de 1,3 GB): nao instalamos nada por duplo clique
if (-not (Test-Path $python)) {
    throw "Ambiente nao encontrado em $venv. Rode primeiro: .\tools\install-f5.ps1"
}
if (-not (Test-Path $ckpt)) {
    throw "Checkpoint pt-BR nao encontrado em $ckpt. Rode primeiro: .\tools\install-f5.ps1"
}

# uma referencia = um .wav com o .txt da transcricao ao lado
$refs = @()
foreach ($wav in Get-ChildItem $refDir -Filter *.wav -ErrorAction SilentlyContinue) {
    if (Test-Path ([System.IO.Path]::ChangeExtension($wav.FullName, '.txt'))) {
        $refs += $wav.BaseName
    } else {
        Write-Host "aviso: $($wav.Name) sem o .txt da transcricao - ignorada" -ForegroundColor Yellow
    }
}

if (-not $refs) {
    throw @"
Nenhuma referencia valida em $refDir.
O F5 clona uma voz, entao precisa de um par:
  minhavoz.wav  -> 5 a 15s de fala limpa
  minhavoz.txt  -> a transcricao exata desse audio
"@
}
if ($refs -notcontains $Voice) {
    Write-Host "aviso: referencia '$Voice' nao existe; o servidor usara '$($refs[0])'" -ForegroundColor Yellow
    $Voice = $refs[0]
}

$serverArgs = @($server, '--port', $Port, '--voice', $Voice, '--nfe', $Nfe, '--device', $(if ($Cuda) { 'cuda' } else { 'cpu' }))

Write-Host ''
Write-Host "F5-TTS no ar em http://localhost:$Port  (referencia: $Voice, $(if ($Cuda) { 'GPU' } else { 'CPU' }), nfe=$Nfe)" -ForegroundColor Green
Write-Host "referencias disponiveis: $($refs -join ', ')" -ForegroundColor DarkGray
Write-Host 'Carregar o checkpoint leva alguns segundos. Ctrl+C encerra.' -ForegroundColor DarkGray
Write-Host ''

$env:PYTHONUTF8 = '1'
& $python @serverArgs
