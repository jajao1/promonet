<# .SYNOPSIS Installs the pinned Playwright Chromium runtime for PromoNET. #>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$version = [version]((node --version).TrimStart('v'))
if ($version.Major -lt 24) { throw 'Node.js 24 ou superior é obrigatório.' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências Node.js.' }
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o Chromium do Playwright.' }
