param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{4}$')]
    [string]$Term,
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ProjectRef,
    [switch]$SectionsOnly,
    [Alias('AllowProduction')][switch]$AllowSharedData
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($ProjectRef -eq 'wsfvhcsfjtblnkzghxnd' -and -not $AllowSharedData) { throw 'Shared data imports require -AllowSharedData.' }
$devStack = Join-Path $PSScriptRoot '.temp/dev-stack'
if (-not $ProjectRef -and -not (Test-Path -LiteralPath (Join-Path $devStack 'supabase/config.toml'))) { throw 'Start scripts/dev-db.ps1 before a local development import.' }
$batchDirectory = Join-Path $PSScriptRoot ".temp/uw-$Term"
$target = if ($ProjectRef) { "--remote=$ProjectRef" } else { '' }
$markerSuffix = if ($ProjectRef) { ".applied-$ProjectRef" } else { '.applied-local' }

Push-Location -LiteralPath $projectRoot
try {
    $pattern = if ($SectionsOnly) { '^sections-\d{3}\.sql$' } else { '^(raw-catalog|catalog|detail)-\d{3}\.sql$' }
    $files = @(Get-ChildItem -LiteralPath $batchDirectory -Filter '*.sql' -File |
        Where-Object { $_.Name -match $pattern } |
        Sort-Object -Property Name)
    if ($SectionsOnly -and -not $files.Count) { throw "No section batches found for UW term $Term." }
    if (-not $SectionsOnly -and -not ($files.Name -match '^catalog-')) {
        throw "No catalog batches found for UW term $Term."
    }
    foreach ($file in $files) {
        $marker = $file.FullName + $markerSuffix
        $checksum = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        if ((Test-Path -LiteralPath $marker) -and [IO.File]::ReadAllText($marker) -eq $checksum) { continue }
        $queryArgs = @('db', 'query', '--file', $file.FullName)
        if ($target) { $queryArgs += @($target, '--yes') }
        else { $queryArgs += @('--workdir', $devStack) }
        npx.cmd --yes supabase@3.1.0 @queryArgs | Out-Null
        if ($LASTEXITCODE -ne 0) {
            @{file=$file.Name;term=$Term;target=if($ProjectRef){$ProjectRef}else{'local-dev'};checksum=$checksum;failed_at=[DateTime]::UtcNow.ToString('o')} |
                ConvertTo-Json | Set-Content -LiteralPath ($file.FullName+'.failed.local') -Encoding utf8
            throw "Import failed at $($file.Name)."
        }
        [IO.File]::WriteAllText($marker, $checksum)
        Write-Output "Applied $($file.Name)"
    }
} finally {
    Pop-Location
}
