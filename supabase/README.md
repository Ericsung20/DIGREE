# DIGREE local database

Run these commands from the repository root with Docker running and Node.js 20 or newer. The CLI commands below use version 3.1.0.

```powershell
npx --yes supabase@3.1.0 start
npx --yes supabase@3.1.0 status
npx --yes supabase@3.1.0 db reset --local
npx --yes supabase@3.1.0 test db
```

Local Studio is available at http://localhost:54323. The app uses the `API_URL` and `ANON_KEY` from local status output. Keep keys in ignored local environment files.

The reset replaces the local database and loads synthetic Spring 2027 demo data. Run the account script after a reset to create two disposable sign-in accounts with separate `enrolled_self_reported` and `planned` records. The script prints generated credentials to the local terminal.

```powershell
powershell -File .\supabase\create-demo-users.ps1
```

See [DB_HANDOFF.md](./DB_HANDOFF.md) for integration.

## Import a UW catalog sample

The importer defaults to Spring 2027 (UW term code `1274`) and fetches COMP SCI 300, COMP SCI 577, MATH 221, and STAT 301. Pass a term code and quoted exact course codes to select a different sample. It reads the [public Course Search & Enroll site](https://public.enroll.wisc.edu/search) data endpoints and the [MadEnroll grade API](https://madenroll.com/openapi). UW's supported institutional [CAOS service](https://kb.wisc.edu/registrar/11753) requires authorization.

Start local Supabase and apply pending migrations, then run from the root of the DB worktree in PowerShell.

```powershell
npx --yes supabase@3.1.0 migration up --local
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()
$sql = node supabase/import-uw-catalog.mjs
if ($LASTEXITCODE -ne 0) { throw 'Catalog fetch failed' }
$sql | docker exec -i supabase_db_DIGREE-db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
```

Real term `1274` and sample term `2027SP` coexist. Reset loads the demo seed, and running the importer again restores the live sample. The importer refreshes bundles returned by UW but retains absent bundles and their meetings to preserve saved records. Seat status is a fetch-time snapshot. Unknown meeting data is excluded from schedulable bundles. Meeting dates, enrollment permissions, live seat refresh, and walking estimates for the new buildings are outside this import.

For a term whose courses already exist in the destination, collect or refresh sections separately. This imports the published section labels and instructor display names without collecting instructor account identifiers or contact details.

```powershell
node supabase/import-uw-term.mjs 1272 catalog
node supabase/import-uw-term.mjs 1272 sections
./supabase/apply-uw-term.ps1 -Term 1272 -SectionsOnly
```

For the hosted database, add the existing `-ProjectRef` argument. The `sections-*.json` reports record unsuccessful fetches. Rerun the sections phase to retry those batches.

To backfill instructor names in previously imported Fall 2026 sections, rerun the `sections` and `-SectionsOnly` commands above. The sections phase regenerates batches produced by the older name parser. The apply script uses the SQL checksums to pick up updated batches.

Signed-in users can read historical course aggregates from `course_grade_stats`. Use `a_ab_rate` and `sample_size` for the optimizer's optional `grade_stats`, and use null when an aggregate is absent. The rate is the share of letter grades that were A or AB. The table holds course aggregates with a source URL and term coverage. Individual student grades remain in the owner-only `grade_entries` table.

## Import a full UW term

Run `node supabase/import-uw-term.mjs 1274 catalog` to fetch term-wide search results and emit catalog SQL. Then run `node supabase/import-uw-term.mjs 1274 detail` to fetch published bundles and grade aggregates. Both phases write batches to the ignored `supabase/.temp/uw-1274/` directory. Apply the `catalog-*.sql` batches before the `detail-*.sql` batches. The detail phase resumes at the first batch without a completed SQL file. Each detail JSON file records fetch failures and excluded packages. To retry a detail batch, remove its generated SQL file and rerun the detail phase.

The catalog uses one row per UW base course ID. Topic variants and cross-listed aliases do not get separate rows. Courses with credit ranges outside the current planning schema are excluded. Only published packages that can be represented as weekly meetings are imported.

Apply the completed batches to the chosen cloud project with:

```powershell
.\supabase\apply-uw-term.ps1 -Term 1274 -ProjectRef <project-ref>
```

Run the command again after more detail files are generated. The script keeps a separate completion marker for each target. For a fresh local database, run without `-ProjectRef`. The full catalog can share course codes with the fixture seed, so load the full catalog into a database without the fixture courses.

### Import UW course requisites

Apply the `create_course_requisites` migration and load the term catalog first. The requisites phase uses the same public UW search and canonical course selection as the catalog import. It writes only new or updated rows in `course_requisites` for existing UW course IDs.

```powershell
node supabase/import-uw-term.mjs 1274 requisites
npx.cmd --yes supabase@3.1.0 db query --file supabase/.temp/uw-1274/requisites.sql
```

For a hosted import, add `--remote=<project-ref> --yes` to the query command. Use term code `1272` and its output directory for Fall 2026. Enrollment and advisory text come from separate UW fields. The import stores published catalog aliases for cross-listed courses and the source map of requirement groups to class numbers. Run the alias migration before refreshing the import.

### Refresh published UW instructor names

After applying the instructor-directory migration, use PowerShell 7 with the term catalog manifest and requisite rows already loaded. The fetch report preserves course IDs with missing names or request failures. The generated SQL stores published names and updates matching scheduler bundles by term, course ID, and bundle ID.

```powershell
node supabase/import-uw-term.mjs 1274 catalog
./supabase/import-uw-instructors.ps1 -Term 1274
$files = Get-Content -Raw supabase/.temp/uw-1274/instructor-files.json | ConvertFrom-Json
foreach ($file in $files) {
    npx.cmd --yes supabase@3.1.0 db query --file $file
    if ($LASTEXITCODE -ne 0) { throw "Instructor import failed at $file" }
}
```

For the cloud, supply `-ProjectRef` to the fetch script and `--remote=<project-ref> --yes` to each query. A package with no published display names leaves the current names in place. Course and meeting data are maintained by the separate catalog and section imports.

## Import UW walking estimates

Run the UW catalog phase and apply the term's meeting data first. The importer reads building coordinates from UW Course Search & Enroll and routes them with Valhalla's pedestrian profile on an OpenStreetMap extract. Reviewed term-specific location exceptions and their sources are recorded in uw-walking-location-review.json. It stores each direction separately and rounds seconds up to whole minutes. Unresolved coordinates or routes stay out of the matrix. The estimates cover mapped pedestrian paths between building coordinates. They exclude classroom-to-door time.

Use a self-hosted Valhalla instance. This example trims the Geofabrik Wisconsin extract to the Madison area and exposes the router on loopback. Check that all reviewed building coordinates for the selected term lie inside the bounds before reusing this extract.

```powershell
$extractDir = (New-Item -ItemType Directory -Force supabase/.temp/uw-walking/valhalla).FullName
$madisonDir = (New-Item -ItemType Directory -Force supabase/.temp/uw-walking/madison).FullName
curl.exe --fail --location --output (Join-Path $extractDir wisconsin-latest.osm.pbf) https://download.geofabrik.de/north-america/us/wisconsin-latest.osm.pbf
docker run --rm --mount "type=bind,source=$extractDir,target=/input,readonly" --mount "type=bind,source=$madisonDir,target=/output" docker.io/iboates/osmium:1.19.0 extract --bbox=-89.55,42.99,-89.30,43.15 --strategy=complete_ways --output=/output/madison.osm.pbf --overwrite /input/wisconsin-latest.osm.pbf
docker run -d --name digree-uw-walking-madison -p 127.0.0.1:18003:8002 --mount "type=bind,source=$madisonDir,target=/custom_files" -e build_admins=False -e build_time_zones=False -e server_threads=2 ghcr.io/valhalla/valhalla-scripted@sha256:5402c8543f083350dade401673cd66071f17e3220983aef4cd10296c72dee77d
```

Query the target database for its distinct in-person and hybrid building IDs. Supply one JSON row per building in `supabase/.temp/uw-walking/buildings-1274.json` with `building_id`, `name` and `course_ids`. Include up to five course IDs from the same term for each building, favoring courses held in more buildings to minimize UW requests.

```sql
with building_courses as (
  select distinct building_id, course_id from public.meetings
  where term = '1274' and building_id like 'uw-%' and mode in ('in_person', 'hybrid')
), ranked as (
  select bc.building_id, bc.course_id,
    row_number() over (
      partition by bc.building_id order by counts.coverage desc, bc.course_id
    ) as rank
  from building_courses bc
  join (select course_id, count(*) as coverage from building_courses group by course_id) counts
    using (course_id)
)
select ranked.building_id, b.name, array_agg(ranked.course_id order by rank) as course_ids
from ranked join public.buildings b on b.id = ranked.building_id
where rank <= 5
group by ranked.building_id, b.name
order by ranked.building_id;
```

After `http://127.0.0.1:18003/status` responds, generate the matrix and review `routes-1274.json` for omissions. Both reports and SQL are written to the ignored `supabase/.temp/uw-walking/` directory. The SQL checks the current set of buildings in the selected term before inserting rows into `walking_edges`.

```powershell
node supabase/import-uw-walking.mjs coordinates 1274
node supabase/import-uw-walking.mjs matrix 1274 http://127.0.0.1:18003
npx.cmd --yes supabase@3.1.0 db query --local --file supabase/.temp/uw-walking/walking-1274.sql
```

For a hosted import, use the intended project reference instead of `--local`. Display [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright) wherever the app displays these walking estimates. The input dataset is from [Geofabrik's Wisconsin extract](https://download.geofabrik.de/north-america/us/wisconsin.html).
