<#
    Gera os PNGs de icons/ a partir da arte original em assets/icon.png.

    Uso:
      .\tools\generate-icons.ps1                       # assets\icon.png -> icons\icon{16,32,48,128}.png
      .\tools\generate-icons.ps1 -Source outra.png     # outra arte de origem
      .\tools\generate-icons.ps1 -Sizes 16,128         # so alguns tamanhos

    Os quatro tamanhos sao os que o manifest.json declara. Rode depois de
    trocar a arte em assets/icon.png e confira o resultado em 16px, que e
    o tamanho da barra do Chrome e o primeiro a perder legibilidade.
#>

param(
    [string]$Source,
    [int[]]$Sizes = @(16, 32, 48, 128)
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = Join-Path $root 'assets\icon.png' }
$dest = Join-Path $root 'icons'

if (-not (Test-Path $Source)) { throw "arte de origem nao encontrada: $Source" }
if (-not (Test-Path $dest)) { throw "pasta de destino nao encontrada: $dest" }

$origin = [System.Drawing.Image]::FromFile($Source)
try {
    Write-Host "origem: $Source ($($origin.Width)x$($origin.Height))" -ForegroundColor DarkGray

    $maior = ($Sizes | Measure-Object -Maximum).Maximum
    if ($origin.Width -lt $maior -or $origin.Height -lt $maior) {
        Write-Warning "a origem e menor que $maior px: os icones maiores vao sair borrados."
    }

    foreach ($size in $Sizes) {
        $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $bmp.SetResolution(96, 96)

        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)

        # TileFlipXY evita a franja transparente que a bicubica cria na borda.
        $attr = New-Object System.Drawing.Imaging.ImageAttributes
        $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
        $g.DrawImage($origin, $rect, 0, 0, $origin.Width, $origin.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)

        $out = Join-Path $dest "icon$size.png"
        $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Host "icon$size.png ($((Get-Item $out).Length) bytes)" -ForegroundColor Green

        $attr.Dispose()
        $g.Dispose()
        $bmp.Dispose()
    }
}
finally {
    $origin.Dispose()
}

Write-Host 'pronto. rode npm run build para copiar os icones para build/.' -ForegroundColor DarkGray
