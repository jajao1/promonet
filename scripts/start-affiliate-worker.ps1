<# .SYNOPSIS Starts the supervised, visible affiliate-link worker. #>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath '.env')) { throw 'Arquivo .env não encontrado.' }
$dryRun = Get-Content .env | Where-Object { $_ -match '^DRY_RUN=' } | Select-Object -Last 1
if ($dryRun -ne 'DRY_RUN=true') { throw 'DRY_RUN deve permanecer true durante o protótipo.' }
$postgres = docker compose ps postgres --format json | ConvertFrom-Json
if (-not $postgres -or $postgres.State -ne 'running' -or $postgres.Health -ne 'healthy') { throw 'PostgreSQL não está saudável.' }
New-Item -ItemType Directory -Force -Path '.\secrets\edge-profile' | Out-Null
node worker/cli.mjs run
if ($LASTEXITCODE -ne 0) { throw 'O worker foi encerrado com falha.' }
