# Requires PowerShell 7. Downloads only the verified UW Guide URLs in the mapping.
param([string]$Directory = (Join-Path $PSScriptRoot '.temp/program-guides'))

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Directory).Path
$pages = Join-Path $root 'pages'
New-Item -ItemType Directory -Force -Path $pages | Out-Null
$programs = Get-Content -Raw -LiteralPath (Join-Path $root 'mapped.json') | ConvertFrom-Json
$results = @($programs | ForEach-Object -Parallel {
    $program = $_
    $directory = $using:pages
    $id = [guid]$program.id
    $url = [uri]$program.url
    $year = [int]$program.catalog_year
    $prefix = if ($year -eq 2026) { '/undergraduate/' } else { "/archive/$year-$($year + 1)/undergraduate/" }
    if ($url.Scheme -ne 'https' -or $url.Host -ne 'guide.wisc.edu' -or -not $url.AbsolutePath.StartsWith($prefix)) {
        [pscustomobject]@{id=$id; error='Unknown UW catalog URL'}
        return
    }
    $file = Join-Path $directory "$id.html"
    if (Test-Path -LiteralPath $file) {
        [pscustomobject]@{id=$id; ok=$true}
        return
    }
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $url -TimeoutSec 20 -ErrorAction Stop
            $final = $response.BaseResponse.RequestMessage.RequestUri
            if ($final.Host -ne 'guide.wisc.edu' -or -not $final.AbsolutePath.StartsWith($prefix)) {
                throw 'Redirected outside the requested UW catalog year.'
            }
            [IO.File]::WriteAllText("$file.tmp", $response.Content)
            Move-Item -LiteralPath "$file.tmp" -Destination $file -Force
            [pscustomobject]@{id=$id; ok=$true}
            return
        } catch {
            if ($attempt -eq 2) {
                [pscustomobject]@{id=$id; error=$_.Exception.Message}
                return
            }
            Start-Sleep -Milliseconds (500 * ($attempt + 1))
        }
    }
} -ThrottleLimit 8)

$report = Join-Path $root 'fetch-report.json'
ConvertTo-Json -InputObject $results -Depth 4 -Compress | Set-Content -LiteralPath $report -Encoding utf8
[pscustomobject]@{
    Programs = @($programs).Count
    Saved = @($results | Where-Object ok).Count
    Failed = @($results | Where-Object error).Count
} | Format-List
