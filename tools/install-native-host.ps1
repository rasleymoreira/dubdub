<#
    Registra o host que liga/desliga o Piper pelos botoes da extensao.

    Uso:
      .\tools\install-native-host.ps1                       # detecta o id sozinho
      .\tools\install-native-host.ps1 -ExtensionId abcd...  # id copiado do chrome://extensions
      .\tools\install-native-host.ps1 -Uninstall

    Escreve um arquivo JSON em tools\native-host e uma chave em
    HKCU (usuario atual) para cada navegador instalado. Nao mexe no sistema.
#>

param(
    [string]$ExtensionId,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$HOST_NAME = 'com.udub.piper'
$root = Split-Path -Parent $PSScriptRoot
$hostDir = Join-Path $root 'tools\native-host'
$manifestPath = Join-Path $hostDir "$HOST_NAME.json"
$batPath = Join-Path $hostDir 'udub-piper-host.bat'

$browsers = @(
    @{ Name = 'Chrome'; Data = "$env:LOCALAPPDATA\Google\Chrome\User Data";                  Reg = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts' }
    @{ Name = 'Edge';   Data = "$env:LOCALAPPDATA\Microsoft\Edge\User Data";                 Reg = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts' }
    @{ Name = 'Brave';  Data = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data";    Reg = 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts' }
)

if ($Uninstall) {
    foreach ($b in $browsers) {
        $key = Join-Path $b.Reg $HOST_NAME
        if (Test-Path $key) {
            Remove-Item $key -Force
            Write-Host "removido de $($b.Name)" -ForegroundColor Yellow
        }
    }
    if (Test-Path $manifestPath) { Remove-Item $manifestPath -Force }
    Write-Host 'Host desinstalado.' -ForegroundColor Green
    return
}

# --- descobre o id da extensao lendo os perfis dos navegadores ------------------
function Find-ExtensionIds {
    $ids = [ordered]@{}
    foreach ($b in $browsers) {
        if (-not (Test-Path $b.Data)) { continue }
        foreach ($profileDir in Get-ChildItem $b.Data -Directory -ErrorAction SilentlyContinue) {
            $prefs = Join-Path $profileDir.FullName 'Preferences'
            if (-not (Test-Path $prefs)) { continue }
            $raw = Get-Content $prefs -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
            if (-not $raw) { continue }
            $needle = (Split-Path $root -Leaf)
            $idx = $raw.IndexOf($needle)
            if ($idx -lt 0) { continue }
            # o id e a ultima chave de 32 letras (a-p) antes do caminho da extensao
            $start = [Math]::Max(0, $idx - 6000)
            $before = $raw.Substring($start, $idx - $start)
            $matches = [regex]::Matches($before, '"([a-p]{32})"\s*:\s*\{')
            if ($matches.Count) {
                $id = $matches[$matches.Count - 1].Groups[1].Value
                $ids[$id] = "$($b.Name)/$($profileDir.Name)"
            }
        }
    }
    return $ids
}

if (-not $ExtensionId) {
    $found = Find-ExtensionIds
    if ($found.Count -eq 1) {
        $ExtensionId = @($found.Keys)[0]
        Write-Host "Extensao encontrada em $($found[$ExtensionId]): $ExtensionId" -ForegroundColor Cyan
    } elseif ($found.Count -gt 1) {
        Write-Host 'Encontrei mais de uma extensao carregada desta pasta:' -ForegroundColor Yellow
        foreach ($k in $found.Keys) { Write-Host "  $k  ($($found[$k]))" }
        throw 'Rode de novo com -ExtensionId <id>.'
    } else {
        throw @'
Nao achei a extensao carregada em nenhum navegador.
Abra chrome://extensions (ou edge://extensions, brave://extensions), copie o ID
que aparece no card da extensao e rode:
  .\tools\install-native-host.ps1 -ExtensionId <id>
'@
    }
}

if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "ID invalido: $ExtensionId" }

# --- manifesto do host ---------------------------------------------------------
$manifest = [ordered]@{
    name            = $HOST_NAME
    description     = 'Liga e desliga o servidor Piper da extensao DubDub'
    path            = $batPath
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$json = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "manifesto: $manifestPath" -ForegroundColor DarkGray

# --- registro (HKCU) -----------------------------------------------------------
$registrados = 0
foreach ($b in $browsers) {
    if (-not (Test-Path $b.Data)) { continue }
    $key = Join-Path $b.Reg $HOST_NAME
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name '(Default)' -Value $manifestPath
    Write-Host "registrado no $($b.Name)" -ForegroundColor Green
    $registrados++
}

if (-not $registrados) { throw 'Nenhum navegador compativel encontrado.' }

Write-Host ''
Write-Host 'Pronto. Recarregue a extensao e use os botoes Ligar/Desligar no popup.' -ForegroundColor Green
Write-Host 'Para remover: .\tools\install-native-host.ps1 -Uninstall' -ForegroundColor DarkGray
