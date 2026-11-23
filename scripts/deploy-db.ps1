param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9]{20}$')][string]$ProjectRef,
    [switch]$Apply,
    [Alias('AllowProduction')][switch]$AllowSharedData
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$protected='wsfvhcsfjtblnkzghxnd'
if($Apply -and $ProjectRef -eq $protected -and -not $AllowSharedData) { throw 'The shared dataset requires -AllowSharedData. Default mode is read-only.' }
function Read-Db([string]$Sql) {
    $queryDirectory=Join-Path $root 'supabase/.temp/preflight'
    New-Item -ItemType Directory -Path $queryDirectory -Force | Out-Null
    $queryPath=Join-Path $queryDirectory ([guid]::NewGuid().ToString('N')+'.sql')
    [IO.File]::WriteAllText($queryPath,$Sql,[Text.UTF8Encoding]::new($false))
    $raw=npx.cmd --yes supabase@3.1.0 db query "--remote=$ProjectRef" --read-only --file $queryPath --output json
    if($LASTEXITCODE -ne 0) { throw ('Read-only database preflight failed: '+($raw -join "`n")) }
    return ($raw | ConvertFrom-Json).rows
}
$history=@(Read-Db 'select version,name from supabase_migrations.schema_migrations order by version')
$files=@(Get-ChildItem -LiteralPath (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name)
$versions=@($files | ForEach-Object { $_.BaseName.Split('_')[0] })
foreach($migration in $history) { if($migration.version -notin $versions) { throw "Remote migration $($migration.version) is absent from source; stop before changing anything." } }
$duplicates=Read-Db "select count(*) as n from(select lower(btrim(email)) from auth.users where email is not null and deleted_at is null and not coalesce(is_sso_user,false) group by lower(btrim(email)) having count(*)>1)x"
if([int]$duplicates.n -ne 0) { throw 'Duplicate normalized account emails require manual reconciliation; no accounts will be deleted.' }
$planned=Read-Db "select count(*) as n from(select user_id,term,course_id from public.user_course_records where status='planned' group by user_id,term,course_id having count(*)>1)x"
if([int]$planned.n -ne 0) { throw 'Duplicate planned courses require reconciliation; no rows will be deleted.' }
$supplementalExists=(Read-Db "select to_regclass('public.supplemental_program_catalog') is not null as present").present
$repairSupplemental=$supplementalExists -and '20261115133400' -notin $history.version
if($repairSupplemental) {
    $shape=Read-Db "select string_agg(column_name||':'||data_type||':'||is_nullable,',' order by ordinal_position) as shape from information_schema.columns where table_schema='public' and table_name='supplemental_program_catalog'"
    $expected='catalog_year:integer:NO,program_key:text:NO,kind:text:NO,name:text:NO,source_url:text:NO,course_groups:jsonb:NO,declaration_groups:jsonb:NO,fetched_at:timestamp with time zone:NO'
    if($shape.shape -ne $expected) { throw 'Existing supplemental table differs from the audited shape; history will not be marked applied.' }
    $constraints=Read-Db "select count(*) as n from pg_constraint where conrelid='public.supplemental_program_catalog'::regclass and conname in('supplemental_program_catalog_pkey','supplemental_program_catalog_kind_check','supplemental_program_catalog_course_groups_check','supplemental_program_catalog_year_key_kind')"
    if([int]$constraints.n -ne 4) { throw 'Supplemental catalog constraints differ from the audited baseline.' }
}
$pending=@($files | Where-Object { $_.BaseName.Split('_')[0] -notin $history.version -and -not($repairSupplemental -and $_.Name -like '20261115133400_*') })
Write-Output "Target: $ProjectRef; apply=$Apply; protected-shared-data=$($ProjectRef -eq $protected)"
if($repairSupplemental) { Write-Output 'Verified existing supplemental catalog: repair missing 20261115133400 history entry (do not recreate table).' }
$pending | ForEach-Object { Write-Output "Pending: $($_.Name)" }
if(-not $Apply) { exit 0 }

# Store schema metadata and before-counts locally; never export account rows.
$backup=Join-Path $root ('supabase/.temp/deploy-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup | Out-Null
$snapshot=Read-Db @'
select jsonb_build_object(
'migrations',(select jsonb_agg(jsonb_build_object('version',version,'name',name)) from supabase_migrations.schema_migrations),
'columns',(select jsonb_agg(to_jsonb(x)) from(select table_schema,table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema in('public','private','ingestion'))x),
'constraints',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint where connamespace in(select oid from pg_namespace where nspname in('public','private','ingestion'))),
'functions',(select jsonb_agg(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','ingestion')),
'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname in('public','private','ingestion')),
'counts',jsonb_build_object('users',(select count(*) from auth.users),'records',(select count(*) from public.user_course_records),'grades',(select count(*) from public.grade_entries),'messages',(select count(*) from public.chat_messages),'courses',(select count(*) from public.courses))) as snapshot
'@
$snapshot | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath (Join-Path $backup 'before.json') -Encoding utf8
if($repairSupplemental) {
    npx.cmd --yes supabase@3.1.0 migration repair 20261115133400 --status applied "--remote=$ProjectRef" --yes
    if($LASTEXITCODE -ne 0) { throw 'Verified supplemental history repair failed.' }
}
# No vault/config/seed deployment. Each reviewed SQL file and its history record
# commit atomically. Historical deployed files are never rewritten or rerun.
foreach($file in $pending) {
    $version=$file.BaseName.Split('_')[0]
    $name=$file.BaseName.Substring($version.Length+1)
    $sql=Get-Content -Raw -LiteralPath $file.FullName
    $escaped=$sql.Replace("'","''")
    $historySql="insert into supabase_migrations.schema_migrations(version,name,statements) values('$version','$name',array['$escaped']);"
    $batch="begin; set local lock_timeout='3s'; set local statement_timeout='120s';`n$sql`n$historySql`ncommit;"
    $batchPath=Join-Path $backup ($file.Name)
    Set-Content -LiteralPath $batchPath -Value $batch -Encoding utf8
    npx.cmd --yes supabase@3.1.0 db query "--remote=$ProjectRef" --file $batchPath --yes | Out-Null
    if($LASTEXITCODE -ne 0) { throw "Migration $version failed and was rolled back. Stop; inspect $backup." }
    Write-Output "Applied $($file.Name)"
}
$after=Read-Db "select count(*) as users,(select count(*) from public.user_course_records) as records,(select count(*) from public.grade_entries) as grades,(select count(*) from public.chat_messages) as messages,(select count(*) from public.courses) as courses from auth.users"
$after | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'after-counts.json') -Encoding utf8
Write-Output "Deployment complete. Schema metadata snapshot: $backup"
