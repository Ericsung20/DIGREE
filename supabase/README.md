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

Signed-in users can read historical course aggregates from `course_grade_stats`. Use `a_ab_rate` and `sample_size` for the optimizer's optional `grade_stats`, and use null when an aggregate is absent. The rate is the share of letter grades that were A or AB. The table holds course aggregates with a source URL and term coverage. Individual student grades remain in the owner-only `grade_entries` table.

## Import a full UW term

Run `node supabase/import-uw-term.mjs 1274 catalog` to fetch term-wide search results and emit catalog SQL. Then run `node supabase/import-uw-term.mjs 1274 detail` to fetch published bundles and grade aggregates. Both phases write batches to the ignored `supabase/.temp/uw-1274/` directory. Apply the `catalog-*.sql` batches before the `detail-*.sql` batches. The detail phase resumes at the first batch without a completed SQL file. Each detail JSON file records fetch failures and excluded packages. To retry a detail batch, remove its generated SQL file and rerun the detail phase.

The catalog uses one row per UW base course ID. Topic variants and cross-listed aliases do not get separate rows. Courses with credit ranges outside the current planning schema are excluded. Only published packages that can be represented as weekly meetings are imported.

Apply the completed batches to the chosen cloud project with:

```powershell
.\supabase\apply-uw-term.ps1 -Term 1274 -ProjectRef <project-ref>
```

Run the command again after more detail files are generated. The script keeps a separate completion marker for each target. For a fresh local database, run without `-ProjectRef`. The full catalog can share course codes with the fixture seed, so load the full catalog into a database without the fixture courses.
