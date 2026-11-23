param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9]{20}$')][string]$ProjectRef,
    [switch]$Apply,
    [switch]$AllowSharedData
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
if($Apply -and $ProjectRef -eq 'wsfvhcsfjtblnkzghxnd' -and -not $AllowSharedData) { throw 'Shared catalog updates require -AllowSharedData.' }
$lists=@('supabase/.temp/program-guides/program-requirement-files.json','supabase/.temp/supplemental-program-guides/supplemental-files.json')
$files=@()
foreach($list in $lists) {
    $issues=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Split-Path (Join-Path $root $list)) 'extraction-issues.json') | ConvertFrom-Json
    if(@($issues).Count -ne 0) { throw 'Resolve all extraction issues before applying the catalog.' }
    $entries=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $list) | ConvertFrom-Json
    foreach($entry in $entries) {
        $path=[IO.Path]::GetFullPath($entry)
        if(-not $path.StartsWith([IO.Path]::GetFullPath((Join-Path $root 'supabase/.temp'))+[IO.Path]::DirectorySeparatorChar)) { throw 'Unexpected staged path outside this workspace.' }
        if(-not(Test-Path -LiteralPath $path)) { throw "Missing staged file $path" }
        $files+=$path
    }
}
Write-Output "Target $ProjectRef; $($files.Count) staged catalog batches; apply=$Apply"
if(-not $Apply) { exit 0 }
foreach($file in $files) {
    # Each batch is bounded by the extractor and the source triggers refresh the
    # corresponding requirement read model in the same transaction.
    $sql=Get-Content -Raw -Encoding UTF8 -LiteralPath $file
    $wrapped="begin; set local lock_timeout='3s'; set local statement_timeout='60s';`n$sql`ncommit;"
    $batch=$file+'.apply.local'
    [IO.File]::WriteAllText($batch,$wrapped,[Text.UTF8Encoding]::new($false))
    npx.cmd --yes supabase@3.1.0 db query "--remote=$ProjectRef" --file $batch --yes | Out-Null
    if($LASTEXITCODE -ne 0) { throw "Catalog batch failed and rolled back: $file" }
    Write-Output "Applied $([IO.Path]::GetFileName($file))"
}
