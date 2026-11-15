param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{4}$')]
    [string]$Term,
    [ValidatePattern('^[a-z0-9]{20}$')]
    [string]$ProjectRef
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$batchDirectory = Join-Path $PSScriptRoot ".temp/uw-$Term"
$target = if ($ProjectRef) { "--remote=$ProjectRef" } else { '' }
$markerSuffix = if ($ProjectRef) { ".applied-$ProjectRef" } else { '.applied-local' }

Push-Location -LiteralPath $projectRoot
try {
    $files = @(Get-ChildItem -LiteralPath $batchDirectory -Filter '*.sql' -File |
        Where-Object { $_.Name -match '^(catalog|detail)-\d{3}\.sql$' } |
        Sort-Object -Property Name)
    if (-not ($files.Name -match '^catalog-')) {
        throw "No catalog batches found for UW term $Term."
    }
    foreach ($file in $files) {
        $marker = $file.FullName + $markerSuffix
        $checksum = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        if ((Test-Path -LiteralPath $marker) -and [IO.File]::ReadAllText($marker) -eq $checksum) { continue }
        $queryArgs = @('db', 'query', '--file', $file.FullName)
        if ($target) { $queryArgs += @($target, '--yes') }
        npx.cmd --yes supabase@3.1.0 @queryArgs | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Import failed at $($file.Name)." }
        [IO.File]::WriteAllText($marker, $checksum)
        Write-Output "Applied $($file.Name)"
    }
} finally {
    Pop-Location
}
