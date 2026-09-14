param(
    [string]$EnvironmentPath = (Join-Path $PSScriptRoot '..\.env'),
    [string]$QrOutputPath = (Join-Path $PSScriptRoot '..\pairing-qr.png')
)

$ErrorActionPreference = 'Stop'

$settings = @{}
foreach ($line in [System.IO.File]::ReadAllLines([System.IO.Path]::GetFullPath($EnvironmentPath))) {
    if ($line -match '^\s*([^#=]+)=(.*)$') {
        $settings[$matches[1].Trim()] = $matches[2].Trim()
    }
}

$apiKey = $settings['EVOLUTION_API_KEY']
$instance = $settings['EVOLUTION_INSTANCE']
$port = $settings['EVOLUTION_PORT']
if ([string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($instance)) {
    throw 'EVOLUTION_API_KEY ou EVOLUTION_INSTANCE ausente no .env.'
}
if ([string]::IsNullOrWhiteSpace($port)) { $port = '8080' }

$baseUrl = "http://127.0.0.1:$port"
$headers = @{ apikey = $apiKey }
$body = @{
    instanceName = $instance
    integration = 'WHATSAPP-BAILEYS'
    qrcode = $true
    groupsIgnore = $false
    readMessages = $false
    syncFullHistory = $false
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/instance/create" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
} catch {
    $status = [int]$_.Exception.Response.StatusCode
    if ($status -notin 400, 403, 409) { throw }
    $response = Invoke-RestMethod -Uri "$baseUrl/instance/connect/$instance" -Method Get -Headers $headers
}

$encoded = $response.qrcode.base64
if ([string]::IsNullOrWhiteSpace($encoded)) { $encoded = $response.base64 }
if ([string]::IsNullOrWhiteSpace($encoded)) {
    $response = Invoke-RestMethod -Uri "$baseUrl/instance/connect/$instance" -Method Get -Headers $headers
    $encoded = $response.base64
    if ([string]::IsNullOrWhiteSpace($encoded)) { $encoded = $response.qrcode.base64 }
}

if ([string]::IsNullOrWhiteSpace($encoded)) {
    Write-Output 'Instancia criada, mas o QR ainda nao foi retornado. Execute novamente em alguns segundos.'
    exit 2
}

$encoded = $encoded -replace '^data:image/[^;]+;base64,', ''
[System.IO.File]::WriteAllBytes(
    [System.IO.Path]::GetFullPath($QrOutputPath),
    [Convert]::FromBase64String($encoded)
)
Write-Output ([System.IO.Path]::GetFullPath($QrOutputPath))
