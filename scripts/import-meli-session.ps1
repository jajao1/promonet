param(
    [Parameter(Mandatory = $true)]
    [string]$RequestPath,
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\secrets\meli-session.json')
)

$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'import-meli-request.mjs') ([IO.Path]::GetFullPath($RequestPath)) ([IO.Path]::GetFullPath($OutputPath))
if ($LASTEXITCODE -ne 0) { throw 'Falha ao importar a requisicao.' }
