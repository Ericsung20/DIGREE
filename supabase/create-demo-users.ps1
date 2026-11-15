# Run after a local reset. Prints disposable local sign-in credentials to your terminal.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot

try {
    $status = npx.cmd --yes supabase@3.1.0 status -o env
    if ($LASTEXITCODE -ne 0) { throw 'Start the local Supabase stack first.' }

    $values = @{}
    foreach ($line in $status) {
        if ($line -match '^([A-Z_]+)="(.*)"$') {
            $values[$Matches[1]] = $Matches[2]
        }
    }

    $api = $values['API_URL']
    if (-not $api -or -not ([uri]$api).IsLoopback -or -not $values['SERVICE_ROLE_KEY']) {
        throw 'Expected a loopback Supabase URL and the local service role key.'
    }

    $localKey = $values['SERVICE_ROLE_KEY']
    $headers = @{ apikey = $localKey; Authorization = "Bearer $localKey" }
    $runId = [guid]::NewGuid().ToString('N').Substring(0, 12)

    $accounts = foreach ($account in @('enrolled', 'planned')) {
        $email = "digree-$account-$runId@example.com"
        $password = [guid]::NewGuid().ToString('N')
        $payload = @{ email = $email; password = $password; email_confirm = $true } | ConvertTo-Json
        $user = Invoke-RestMethod -Method Post -Uri "$api/auth/v1/admin/users" `
            -Headers $headers -ContentType 'application/json' -Body $payload

        $statusName = if ($account -eq 'enrolled') { 'enrolled_self_reported' } else { 'planned' }
        $record = @{
            user_id = $user.id
            term = '2027SP'
            course_id = 'cs400'
            bundle_id = 'cs400-A'
            credits = 3
            status = $statusName
        } | ConvertTo-Json
        Invoke-RestMethod -Method Post -Uri "$api/rest/v1/user_course_records" `
            -Headers $headers -ContentType 'application/json' -Body $record | Out-Null

        [pscustomobject]@{ Email = $email; Password = $password; Status = $statusName }
    }
    $accounts
} finally {
    Pop-Location
}
