# Requires PowerShell 7. Writes SQL and a fetch report without applying any database changes.
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{4}$')][string]$Term,
    [ValidatePattern('^[a-z0-9]{20}$')][string]$ProjectRef,
    [string[]]$InputFiles,
    [switch]$ManifestOnly
)

$ErrorActionPreference = 'Stop'
$directory = Join-Path $PSScriptRoot ".temp/uw-$Term"

if ($InputFiles) {
    $results = @(foreach ($file in $InputFiles) {
        Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    })
} else {
    $manifest = Get-Content -LiteralPath (Join-Path $directory 'manifest.json') -Raw | ConvertFrom-Json
    $ids = if ($ManifestOnly) {
        $manifest.entries | ForEach-Object { $_.course.id } | Sort-Object -Unique
    } else {
        $query = "select array_agg(course_id order by course_id) as ids from public.course_requisites where term='$Term'"
        $targetArgs = if ($ProjectRef) { @("--remote=$ProjectRef") } else { @() }
        $snapshot = npx.cmd --yes supabase@3.1.0 db query @targetArgs --read-only $query
        if ($LASTEXITCODE -ne 0) { throw "Unable to read the catalog for $Term." }
        ($snapshot | ConvertFrom-Json).rows[0].ids
    }
    $entries = @{}
    foreach ($entry in $manifest.entries) { $entries[$entry.course.id] = $entry }
    $work = @(foreach ($id in $ids) {
        $entry = $entries[$id]
        if ($entry) {
            [pscustomobject]@{course_id=$id; source_id=$entry.courseId; subject=$entry.subject.subjectCode; term=$Term}
        }
    })
    if (-not $work.Count -or $work.Count -ne $ids.Count) {
        throw "Matched $($work.Count) of $($ids.Count) catalog courses in the UW manifest for $Term."
    }

    $results = @($work | ForEach-Object -Parallel {
        $entry = $_
        $url = "https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/$($entry.term)/$($entry.subject)/$($entry.source_id)"
        for ($retry = 0; $retry -lt 3; $retry++) {
            try {
                $packages = Invoke-RestMethod -Uri $url -TimeoutSec 12 -ErrorAction Stop
                if ($packages -is [string]) { throw 'Expected a JSON package list.' }
                $namesByBundle = @(foreach ($package in $packages) {
                    if ($package.published -ne $true -or -not $package.docId) { continue }
                    $names = @(foreach ($section in $package.sections) {
                        foreach ($instructor in $section.instructors) {
                            $name = $instructor.name
                            if ($name -is [string]) { $name.Trim(); continue }
                            ($name.first, $name.middle, $name.last | Where-Object { $_ } | ForEach-Object { $_.Trim() }) -join ' '
                        }
                    })
                    $names = @($names | Where-Object { $_ } | Select-Object -Unique)
                    if ($names.Count) {
                        [pscustomobject]@{course_id=$entry.course_id; bundle_id=$package.docId; instructors=$names}
                    }
                })
                [pscustomobject]@{course_id=$entry.course_id; packages=@($packages).Count; names=$namesByBundle}
                Start-Sleep -Milliseconds 150
                return
            } catch {
                if ($retry -eq 2) {
                    [pscustomobject]@{course_id=$entry.course_id; error=$_.Exception.Message}
                    return
                }
                Start-Sleep -Milliseconds (500 * ($retry + 1))
            }
        }
    } -ThrottleLimit 8)
}

New-Item -ItemType Directory -Force -Path $directory | Out-Null
$report = Join-Path $directory 'instructors.json'
ConvertTo-Json -InputObject $results -Depth 6 -Compress | Set-Content -LiteralPath $report -Encoding utf8
$rows = @($results | ForEach-Object { $_.names } | Where-Object { $_ } | Sort-Object course_id,bundle_id -Unique)
if ($rows.Where({ -not $_.bundle_id.StartsWith("$Term-") }).Count) { throw "Unexpected bundle term in $report." }
$fetchTime = [DateTimeOffset]::UtcNow.ToString('o')
$slash = [string][char]92
$batchSize = 4000
$files = @(for ($offset = 0; $offset -lt $rows.Count; $offset += $batchSize) {
    $batch = @($rows | Select-Object -Skip $offset -First $batchSize)
    $json = (ConvertTo-Json -InputObject $batch -Depth 4 -Compress).Replace($slash, $slash + $slash).Replace("'", "''")
    $sql = @"
with fetched as (
    select '$Term' as term, incoming.course_id, incoming.bundle_id, incoming.instructors
    from jsonb_to_recordset(E'$json'::jsonb) as incoming(course_id text, bundle_id text, instructors text[])
    join public.courses as course on course.id=incoming.course_id and course.source='uw_public_course_search'
    where cardinality(incoming.instructors)>0
), saved as (
    insert into public.course_instructors(term, course_id, bundle_id, instructors, source_url, fetched_at)
    select term, course_id, bundle_id, instructors, 'https://public.enroll.wisc.edu/search', '$fetchTime'::timestamptz
    from fetched
    on conflict (term, course_id, bundle_id) do update
    set instructors=excluded.instructors, source_url=excluded.source_url, fetched_at=excluded.fetched_at
    where course_instructors.fetched_at <= excluded.fetched_at
    returning term, course_id, bundle_id, instructors
)
update public.section_bundles as bundle
set instructors = saved.instructors
from saved
where bundle.term=saved.term and bundle.course_id=saved.course_id and bundle.bundle_id=saved.bundle_id
  and bundle.instructors is distinct from saved.instructors;
"@
    $number = [int]($offset / $batchSize) + 1
    $path = Join-Path $directory ('instructors-{0:D3}.sql' -f $number)
    Set-Content -LiteralPath $path -Value $sql -Encoding utf8
    $path
})

ConvertTo-Json -InputObject $files -Compress | Set-Content -LiteralPath (Join-Path $directory 'instructor-files.json') -Encoding utf8
[pscustomobject]@{
    Term = $Term
    Courses = $results.Count
    NamesByBundle = $rows.Count
    Failures = @($results | Where-Object { $_.error }).Count
    Files = $files.Count
} | Format-List
