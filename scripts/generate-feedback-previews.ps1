$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $root 'feedback'
$targetDir = Join-Path $root 'feedback-preview'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
$encoderParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
  [System.Drawing.Imaging.Encoder]::Quality, [long]74
)

try {
  foreach ($file in Get-ChildItem -LiteralPath $sourceDir -File | Where-Object { $_.Extension -match '^\.jpe?g$' }) {
    $image = [System.Drawing.Image]::FromFile($file.FullName)
    try {
      $scale = [Math]::Min(1.0, 320.0 / [double]$image.Width)
      $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
      $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
      $bitmap = [System.Drawing.Bitmap]::new($width, $height)
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          $graphics.DrawImage($image, 0, 0, $width, $height)
        } finally {
          $graphics.Dispose()
        }
        $bitmap.Save((Join-Path $targetDir $file.Name), $codec, $encoderParams)
      } finally {
        $bitmap.Dispose()
      }
    } finally {
      $image.Dispose()
    }
  }
} finally {
  $encoderParams.Dispose()
}

$sourceCount = (Get-ChildItem -LiteralPath $sourceDir -File | Where-Object { $_.Extension -match '^\.jpe?g$' }).Count
$previewCount = (Get-ChildItem -LiteralPath $targetDir -File | Where-Object { $_.Extension -match '^\.jpe?g$' }).Count
if ($previewCount -ne $sourceCount) { throw "Expected $sourceCount previews; generated $previewCount." }
Write-Output "Generated $previewCount feedback previews."
