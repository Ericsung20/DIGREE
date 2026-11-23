# DIGREE database revision

The existing hosted project is **shared development** by team choice. No new cloud project, paid branch, or paid upgrade was created. The free account already has two active projects. A separate production project is deferred until public launch. Public environment identity lives in `supabase/environments.json`; credentials remain outside Git.

## Data boundaries

| Area | Stable interface | Storage / meaning |
|---|---|---|
| Course identity | `catalog_courses`, `search_catalog_courses` | Existing `courses.id` and canonical `code`; aliases in `course_aliases`; separate combined display label |
| Term data | `course_offerings` | Per-term title/credits/breadth/repeatable snapshots. Legacy backfill is explicitly marked; historic values are not claimed to have been freshly collected |
| Sections | Existing bundle/meeting contract | `(term,course_id,bundle_id)` preserved for optimizer compatibility |
| Instructors | `catalog_instructors` | `course_instructors` is authoritative; bundle instructor array is a compatibility cache; source-only names are retained |
| Programs | `program_versions`, `student_programs` | Versioned major/minor/certificate catalog plus an owner-filtered unified selection view over existing profile writes |
| Requirements | `requirement_groups` | Stable source-path identities and original group JSON, program version and source URL |
| History / intent | `course_attempts`, `planner_courses` | Separate writable views over one legacy storage table during compatibility; no dual-write copies |
| Plan saving | `save_schedule`, active schedule state | One owner/term/mode active plan; transactional header/items and archiving; per-owner/term lock |
| Transfer | `transfer_credits` | Owner-only self-reported recognized awards and optional canonical UW equivalent |
| Account identity | `private.account_emails` | Atomic normalized email uniqueness; managed Supabase Auth indexes remain intact |
| Collection | `ingestion.import_runs`, `ingestion.source_snapshots` | Non-exposed batch metadata, checksums and source payloads; failed apply metadata is saved locally for retry |

The legacy tables remain for older clients and existing foreign keys. The app no longer uses schedule names as an activation mechanism or historical permission values as a sharing decision. `schedule_permissions` is deprecated compatibility data; removal belongs to a later contract migration after older clients are retired.

## Academic calculation

The requirements screen reads all selected program versions, replacing the old hard-coded CS course list and universal 120-credit constant. A degree minimum is read only from the primary program's explicit degree-total rule. Exact course and simple choose-N checks use canonical aliases. Ambiguous conditions, overlap, grade, residency, footnotes, unparsed criteria and credit shortfalls remain review items. The imported Guide JSON is not represented as a fully verified university audit.

Mapped recognized transfer equivalents inform prerequisite evidence, completed-course exclusion and degree estimates. Unknown transfer grades cannot meet a minimum letter-grade rule. Unmapped transfer contributes recognized credits only. Transfer credits cannot join chat, appear as current enrollment or affect UW GPA. A non-repeatable course completed at UW and recognized externally earns credit once. Repeatable metadata is honored when combining UW and transfer totals. The current transfer record constraint allows one award record per UW equivalent; combined source awards should be entered as one recognized total and edited when corrected.

## Migration reconciliation and data preservation

The three deployed friend-sharing SQL files were restored to source. Existing supplemental catalog DDL was checked before recording its missing historical migration; it was not recreated. The missing vote-floor and designation functions were applied. New changes use forward migration files, with schema and backfills separated.

The deployment helper takes an explicit project ref, defaults to read-only preflight, checks duplicate identities/planned records and stores a schema metadata snapshot plus before/after counts under ignored `supabase/.temp`. Each SQL file and its history record commit in one transaction, with bounded lock and statement timeouts. No seed or vault update is pushed. Shared-data application requires `-Apply -AllowSharedData`.

Verified shared dataset after rollout: 3 accounts, 53 course records, 31 grade rows, 17 chat messages and 6,890 courses; all matched the pre-deployment counts. New read models contain 7,952 aliases, 10,841 term offerings, 1,268 program versions and 13,862 requirement groups. `uw-011630` keeps canonical `COMP SCI 240` with aliases `COMP SCI 240`/`MATH 240` and display `CS/MATH 240`. The applied history contains 35 migrations.

## Validation

- Type generation, web typecheck and ESLint.
- 60 web tests including both actual optimizer integration cases.
- 133 PostgreSQL assertions covering owner RLS, friend transitions, case-insensitive identity uniqueness, canonical alias search, transfer boundaries and atomic save rollback.
- Eight live local API scenarios including concurrent schedule saves, simultaneous duplicate signup, cross-list lookup, term snapshot preservation and instructor authority.
- 289 optimizer tests; OpenAPI contract and reference fixtures unchanged.
- Next.js production build, including `/profile/transfer`.
- Browser signup/onboarding, transfer equivalent selection/save and persistence after reload on the isolated local stack.

Shared-cloud verification used read-only schema/count queries rather than creating disposable users in the shared dataset. The local regression stack remains available for destructive/failure/concurrency tests; everyday shared development needs no Docker.

## Requirement completeness follow-up

The old `main` web process on port 3000 still displayed its hard-coded Programming core. It was replaced with the `db_fix` web process. The importer also now retains prose conditions, full criterion labels and secondary table cells. The screen displays every imported row independently of automatic matching, preserves course evidence badges, and reports loading/missing/error states explicitly.

Re-extracted the existing cached Guide HTML (no new university fetch): 763 major versions covering 197 distinct major labels and 505 minor/certificate versions, with zero extraction issues. After all 77 catalog batches, 1,268 program versions have 12,728 nonempty requirement groups; none lacks requirements and every derived group exactly equals its source JSON. Adjacent tables and prose with the same heading are now combined into one section, so group counts are not comparable to the first rollout. CS BS 2026 has 17 sections and Data Science BS has 14. Existing account/course-record/grade/message counts remained 3/53/31/17.

The shared catalog contains 791 courses with multiple aliases, including `CS/E C E 252` and `A A E/ENVIR ST 244`; cross-list identity is applied generically. This coverage describes imported data rather than every possible university course.

Follow-up validation: 61 web tests including both live optimizer cases, five Python extraction tests including long Unicode criteria, typecheck, ESLint, production build, and authenticated browser checks of both selected majors and CS GPA/residency prose. Docker Desktop was stopped; the web and optimizer use native processes with hosted Supabase.

To apply newly extracted requirement batches, `scripts/apply-requirements.ps1 -ProjectRef <ref>` previews only. Applying requires `-Apply` and the shared project additionally requires `-AllowSharedData`. It rejects extraction issues, limits inputs to the ignored staging directory, reads UTF-8 explicitly on Windows, and applies each batch transactionally with lock and statement timeouts.

## Simplified award entry

Migration `20261123090800` makes transfer source school/course nullable while requiring either a canonical UW equivalent or an identified source course. Existing metadata, owner RLS, credit checks and unique UW-equivalent enforcement remain. The UI requires only the recognized UW course and credit amount; optional school/semester selections persist between additions, and new awards default to the current recognition term. Legacy general-credit records remain editable. Course-only awards use the same transfer cache, canonical prerequisite evidence and degree-credit path as earlier entries.

Requirement cards use concise leaf titles under a single program heading and start collapsed. All source rows remain available inside each card. Validation includes 63 web tests (both live optimizer cases), typecheck, lint, build, and a rolled-back shared-DB test covering source-less insert/read/edit, duplicate rejection, invalid credit and owner isolation. The migration was then deployed with history and existing application data counts preserved; Docker remained stopped.
