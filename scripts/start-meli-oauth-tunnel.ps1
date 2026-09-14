<#
.SYNOPSIS
Starts a temporary Cloudflare tunnel for the Mercado Livre OAuth callback.
.PARAMETER BotPort
Local PromoNET bot port. Defaults to 3000.
#>
[CmdletBinding()]
param([ValidateRange(1, 65535)][int]$BotPort = 3000)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:$BotPort/health" -UseBasicParsing -TimeoutSec 5
  if ($health.StatusCode -ne 200) { throw 'health' }
} catch {
  throw "O bot não está disponível em http://127.0.0.1:$BotPort/health. Inicie os containers primeiro."
}

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  $installedPath = Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'
  if (Test-Path -LiteralPath $installedPath) {
    $cloudflaredPath = $installedPath
  } else {
    Write-Host 'cloudflared não está instalado. Execute:'
    Write-Host 'winget install --id Cloudflare.cloudflared --exact'
    exit 2
  }
} else {
  $cloudflaredPath = $cloudflared.Source
}

$tempDirectory = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ("promonet-tunnel-" + [guid]::NewGuid().ToString('N')))
$stdoutPath = Join-Path $tempDirectory.FullName 'stdout.log'
$stderrPath = Join-Path $tempDirectory.FullName 'stderr.log'
$process = Start-Process -FilePath $cloudflaredPath -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$BotPort", '--no-autoupdate') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

$deadline = (Get-Date).AddSeconds(30)
$tunnelUrl = $null
while ((Get-Date) -lt $deadline -and -not $process.HasExited) {
  Start-Sleep -Milliseconds 500
  $content = ((Get-Content -Raw $stdoutPath -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw $stderrPath -ErrorAction SilentlyContinue))
  $match = [regex]::Match($content, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($match.Success) { $tunnelUrl = $match.Value; break }
}
if (-not $tunnelUrl) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id }
  throw 'O Cloudflare Tunnel não forneceu uma URL HTTPS em até 30 segundos.'
}

Write-Host "Processo do túnel: $($process.Id)"
Write-Host 'Cadastre exatamente esta URI de redirect no Mercado Livre:'
Write-Host "$tunnelUrl/oauth/mercadolivre/callback"
Write-Host 'Mantenha este processo em execução até concluir a autorização.'
