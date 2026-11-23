param([ValidateSet('start','test','status','prepare')][string]$Action='start')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$stack=Join-Path $root 'supabase/.temp/dev-stack'
$configuration=Join-Path $stack 'supabase'
New-Item -ItemType Directory -Force -Path $configuration | Out-Null
$config=Get-Content -Raw (Join-Path $root 'supabase/config.toml')
$config=$config.Replace('project_id = "DIGREE-db"','project_id = "DIGREE-dev"')
# Keep existing local databases and the app on port 3000 undisturbed.
foreach($port in @(54320,54321,54322,54323,54324,54325,54326,54327,54329)) {
    $config=$config.Replace([string]$port,[string]($port+1000))
}
Set-Content -LiteralPath (Join-Path $configuration 'config.toml') -Value $config -Encoding utf8
Copy-Item -LiteralPath (Join-Path $root 'supabase/migrations') -Destination $configuration -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'supabase/tests') -Destination $configuration -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'supabase/seed.sql') -Destination $configuration -Force
if($Action -eq 'prepare') { Write-Output $stack; exit }
if($Action -eq 'start') {
    $result=npx.cmd --yes supabase@3.1.0 start --workdir $stack --output json
    if($LASTEXITCODE -ne 0) { throw 'Supabase start failed.' }
    $status=$result | ConvertFrom-Json
    Write-Output "Development API: $($status.API_URL)"
    Write-Output "Development Studio: $($status.STUDIO_URL)"
} elseif($Action -eq 'test') {
    npx.cmd --yes supabase@3.1.0 migration up --local --workdir $stack
    if($LASTEXITCODE -ne 0) { throw 'Dev migration failed.' }
    npx.cmd --yes supabase@3.1.0 test db --workdir $stack
} else {
    $status=npx.cmd --yes supabase@3.1.0 status --workdir $stack --output json | ConvertFrom-Json
    if($LASTEXITCODE -ne 0) { throw 'Supabase status failed.' }
    Write-Output "Development API: $($status.API_URL)"
    Write-Output "Development Studio: $($status.STUDIO_URL)"
}
if($LASTEXITCODE -ne 0) { throw "Supabase $Action failed." }
