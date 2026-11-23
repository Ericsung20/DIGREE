param([switch]$ReplaceExisting)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$status=npx.cmd --yes supabase@3.1.0 status --workdir (Join-Path $root 'supabase/.temp/dev-stack') --output json | ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or ([uri]$status.API_URL).Host -notin @('127.0.0.1','localhost') -or ([uri]$status.API_URL).Port -ne 55321) { throw 'Expected isolated local dev Supabase on port 55321.' }
$path=Join-Path $root 'apps/web/.env.local'
if(Test-Path -LiteralPath $path) {
    if(-not $ReplaceExisting) { throw 'Existing .env.local preserved. Use -ReplaceExisting to back it up and switch to local dev.' }
    Copy-Item -LiteralPath $path -Destination (Join-Path $root 'apps/web/.env.dev-backup.local')
}
[IO.File]::WriteAllLines($path,@('DIGREE_MOCK=0','NEXT_PUBLIC_DIGREE_DATA=supabase',
    'OPTIMIZER_URL=http://127.0.0.1:8100',"NEXT_PUBLIC_SUPABASE_URL=$($status.API_URL)",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=$($status.ANON_KEY)"),[Text.UTF8Encoding]::new($false))
Write-Output 'Web configured for local development DB. No server/admin keys were written.'
