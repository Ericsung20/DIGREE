$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$status=npx.cmd --yes supabase@3.1.0 status --workdir (Join-Path $root 'supabase/.temp/dev-stack') --output json | ConvertFrom-Json
if($LASTEXITCODE -ne 0) { throw 'Start scripts/dev-db.ps1 first.' }
if(([uri]$status.API_URL).Host -notin @('127.0.0.1','localhost') -or ([uri]$status.API_URL).Port -ne 55321) { throw 'Integration checks are restricted to the isolated local stack.' }
$status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'supabase/.temp/dev-test-env.json') -Encoding utf8
node scripts/check-dev.mjs
if($LASTEXITCODE -ne 0) { throw 'Local integration checks failed.' }
