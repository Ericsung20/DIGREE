param(
    [Parameter(Mandatory=$true)][string]$PublicKey,
    [string]$OptimizerUrl='http://127.0.0.1:8000',
    [switch]$ReplaceExisting
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$environment=Get-Content -Raw -LiteralPath (Join-Path $root 'supabase/environments.json') | ConvertFrom-Json
if($PublicKey.StartsWith('sb_secret_')) { throw 'Use a public anon/publishable key, never a secret/service-role key.' }
if(-not $PublicKey.StartsWith('sb_publishable_')) {
    $parts=$PublicKey.Split('.')
    if($parts.Length -ne 3) { throw 'Expected the project public anon or publishable key.' }
    $payload=$parts[1].Replace('-','+').Replace('_','/')
    $payload=$payload.PadRight($payload.Length+((4-$payload.Length%4)%4),'=')
    $claims=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
    if($claims.role -ne 'anon') { throw 'Only the public anon role can be written to the web environment.' }
}
$optimizer=[uri]$OptimizerUrl
if($optimizer.Scheme -notin @('http','https')) { throw 'Invalid optimizer URL.' }
$path=Join-Path $root 'apps/web/.env.local'
if(Test-Path -LiteralPath $path) {
    if(-not $ReplaceExisting) { throw 'Existing .env.local preserved. Use -ReplaceExisting to back it up and switch to shared development.' }
    Copy-Item -LiteralPath $path -Destination (Join-Path $root 'apps/web/.env.shared-backup.local')
}
[IO.File]::WriteAllLines($path,@('DIGREE_MOCK=0','NEXT_PUBLIC_DIGREE_DATA=supabase',
    "OPTIMIZER_URL=$OptimizerUrl","NEXT_PUBLIC_SUPABASE_URL=$($environment.sharedDevelopment.url)",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=$PublicKey"),[Text.UTF8Encoding]::new($false))
Write-Output "Web connected to shared development project $($environment.sharedDevelopment.projectRef). Restart the web server after changing environments."
