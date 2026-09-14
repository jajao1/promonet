param(
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\.env')
)

$ErrorActionPreference = 'Stop'

if (Test-Path -LiteralPath $OutputPath) {
    throw "O arquivo .env ja existe; ele nao foi sobrescrito."
}

function New-HexSecret {
    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToHexString($bytes).ToLowerInvariant()
}

$content = @(
    "POSTGRES_PASSWORD=$(New-HexSecret)"
    "EVOLUTION_API_KEY=$(New-HexSecret)"
    "WEBHOOK_SECRET=$(New-HexSecret)"
    'EVOLUTION_INSTANCE=promonet'
    'EVOLUTION_PORT=8080'
    'BOT_PORT=3000'
    'EVOLUTION_PUBLIC_URL=http://localhost:8080'
    'DRY_RUN=true'
) -join [Environment]::NewLine

[System.IO.File]::WriteAllText(
    [System.IO.Path]::GetFullPath($OutputPath),
    $content + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Output 'Arquivo .env criado com segredos aleatorios; valores nao exibidos.'
