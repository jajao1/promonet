param([string]$EnvironmentPath = (Join-Path $PSScriptRoot '..\.env'))

$ErrorActionPreference = 'Stop'
$settings = @{}
foreach ($line in [IO.File]::ReadAllLines([IO.Path]::GetFullPath($EnvironmentPath))) {
    if ($line -match '^\s*([^#=]+)=(.*)$') {
        $settings[$matches[1].Trim()] = $matches[2].Trim()
    }
}

$headers = @{ apikey = $settings['EVOLUTION_API_KEY'] }
$baseUrl = "http://127.0.0.1:$($settings['EVOLUTION_PORT'])"
$instance = $settings['EVOLUTION_INSTANCE']
$state = Invoke-RestMethod -Uri "$baseUrl/instance/connectionState/$instance" -Headers $headers
$connection = $state.instance.state
if ([string]::IsNullOrWhiteSpace($connection)) { $connection = $state.instance.connectionStatus }
Write-Output "CONNECTION_STATE=$connection"
if ($connection -notin 'open', 'connected') { throw 'A instancia ainda nao esta conectada.' }

$payload = @{
    webhook = @{
        enabled = $true
        url = 'http://bot:3000/webhooks/evolution'
        byEvents = $false
        base64 = $false
        headers = @{ 'x-webhook-secret' = $settings['WEBHOOK_SECRET'] }
        events = @('MESSAGES_UPSERT')
    }
} | ConvertTo-Json -Depth 6

$null = Invoke-RestMethod -Uri "$baseUrl/webhook/set/$instance" -Method Post -Headers $headers -ContentType 'application/json' -Body $payload
$saved = Invoke-RestMethod -Uri "$baseUrl/webhook/find/$instance" -Headers $headers
Write-Output ('WEBHOOK_ENABLED=' + [bool]$saved.enabled)

$qrPath = Join-Path $PSScriptRoot '..\pairing-qr.png'
if (Test-Path -LiteralPath $qrPath) { Remove-Item -LiteralPath $qrPath -Force }
Write-Output 'PAIRING_QR_REMOVED=true'
