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
$groups = Invoke-RestMethod -Uri "$baseUrl/group/fetchAllGroups/$instance`?getParticipants=false" -Headers $headers

$index = 0
foreach ($group in @($groups) | Sort-Object subject) {
    $index++
    [PSCustomObject]@{
        Number = $index
        Name = $group.subject
        Id = $group.id
        Size = $group.size
    }
}
