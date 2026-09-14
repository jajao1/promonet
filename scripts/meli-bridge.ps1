param(
    [string]$Prefix = 'http://127.0.0.1:3210/',
    [Parameter(Mandatory = $true)][string]$Key,
    [string]$SessionPath = (Join-Path $PSScriptRoot '..\secrets\meli-session.json')
)
$ErrorActionPreference = 'Stop'
$endpoint = 'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink'

function Test-FixedSecret([string]$Actual, [string]$Expected) {
    $a = [Text.Encoding]::UTF8.GetBytes($Actual ?? '')
    $b = [Text.Encoding]::UTF8.GetBytes($Expected ?? '')
    return $a.Length -eq $b.Length -and [Security.Cryptography.CryptographicOperations]::FixedTimeEquals($a, $b)
}
function Send-Json($Context, [int]$Status, $Value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Compress))
    $Context.Response.StatusCode = $Status
    $Context.Response.ContentType = 'application/json'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}

if ($Key.Length -lt 32) { throw 'bridge_key_too_short' }
$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add($Prefix)
$listener.Start()
Write-Output '{"event":"meli_bridge_ready"}'
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            if ($context.Request.HttpMethod -ne 'POST' -or $context.Request.Url.AbsolutePath -ne '/convert') { Send-Json $context 404 @{ valid=$false; category='not_found' }; continue }
            if (-not (Test-FixedSecret $context.Request.Headers['Authorization'] "Bearer $Key")) { Send-Json $context 401 @{ valid=$false; category='unauthorized' }; continue }
            if ($context.Request.ContentLength64 -lt 1 -or $context.Request.ContentLength64 -gt 16384) { Send-Json $context 400 @{ valid=$false; category='request_invalid' }; continue }
            $reader = [IO.StreamReader]::new($context.Request.InputStream, [Text.Encoding]::UTF8, $false, 16384, $false)
            $input = $reader.ReadToEnd() | ConvertFrom-Json
            $uri = [Uri]$input.url
            if ($uri.Scheme -ne 'https' -or $uri.Host -notin @('www.mercadolivre.com.br','mercadolivre.com.br','meli.la') -or $input.tag -notmatch '^[A-Za-z0-9_-]{1,80}$') { Send-Json $context 400 @{ valid=$false; category='request_invalid' }; continue }
            $session = Get-Content -LiteralPath $SessionPath -Raw | ConvertFrom-Json
            $webSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
            foreach ($pair in ($session.cookie -split '; ')) {
                $parts = $pair -split '=', 2
                if ($parts.Count -eq 2) { $webSession.Cookies.Add([Net.Cookie]::new($parts[0], $parts[1], '/', '.mercadolivre.com.br')) }
            }
            $headers = @{}
            foreach ($property in $session.browserHeaders.PSObject.Properties) { $headers[$property.Name] = [string]$property.Value }
            $headers['x-csrf-token'] = [string]$session.csrfToken
            $headers['Origin'] = [string]$session.origin
            $headers['Referer'] = [string]$session.referer
            $sourceUrl = [string]$input.url
            if ($uri.Host -eq 'meli.la') {
                $resolved = Invoke-WebRequest -UseBasicParsing -Uri $sourceUrl -Method GET -WebSession $webSession -Headers $headers -MaximumRedirection 5 -SkipHttpErrorCheck
                if ($resolved.StatusCode -ne 200) { Send-Json $context 502 @{ valid=$false; category='affiliate_source_invalid' }; continue }
                $finalUri = $resolved.BaseResponse.RequestMessage.RequestUri
                if ($finalUri.Scheme -ne 'https' -or $finalUri.Host -notlike '*.mercadolivre.com.br' -or $finalUri.AbsolutePath -notmatch 'MLB-?\d+') { Send-Json $context 502 @{ valid=$false; category='affiliate_source_invalid' }; continue }
                $sourceUrl = $finalUri.GetLeftPart([UriPartial]::Path) + $finalUri.Query
            }
            $body = @{ urls=@($sourceUrl); tag=[string]$input.tag } | ConvertTo-Json -Compress
            $response = Invoke-WebRequest -UseBasicParsing -Uri $endpoint -Method POST -WebSession $webSession -Headers $headers -ContentType 'application/json' -Body $body -MaximumRedirection 0 -SkipHttpErrorCheck
            if ($response.StatusCode -in @(301,302,303,307,308,401,403)) { Send-Json $context 401 @{ valid=$false; category='session_expired' }; continue }
            if ($response.StatusCode -ne 200) { Send-Json $context 502 @{ valid=$false; category='remote_request_failed' }; continue }
            $data = $response.Content | ConvertFrom-Json
            $entry = $data.urls | Select-Object -First 1
            $short = [Uri]$entry.short_url
            if ($data.status -ne 200 -or $data.total_success -ne 1 -or $data.total_error -ne 0 -or @($data.urls).Count -ne 1 -or $entry.created -ne $true -or $entry.tag -ne $input.tag -or $short.Scheme -ne 'https' -or $short.Host -ne 'meli.la') { Send-Json $context 502 @{ valid=$false; category='affiliate_response_invalid' }; continue }
            Send-Json $context 200 @{ valid=$true; affiliateUrl=$short.AbsoluteUri }
        } catch {
            if ($context.Response.OutputStream.CanWrite) { Send-Json $context 500 @{ valid=$false; category='bridge_failed' } }
        }
    }
} finally { $listener.Stop(); $listener.Close() }
