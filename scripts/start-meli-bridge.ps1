$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$keyPath = Join-Path $root 'secrets\meli-bridge-key.txt'
if (-not (Test-Path -LiteralPath $keyPath)) {
    $bytes = [byte[]]::new(48)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $generated = [Convert]::ToBase64String($bytes)
    [IO.File]::WriteAllText($keyPath, $generated, [Text.UTF8Encoding]::new($false))
}
$key = [IO.File]::ReadAllText($keyPath).Trim()
& (Join-Path $PSScriptRoot 'meli-bridge.ps1') -Key $key -SessionPath (Join-Path $root 'secrets\meli-session.json')
