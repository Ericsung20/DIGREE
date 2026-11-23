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
