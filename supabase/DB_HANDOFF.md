# DIGREE DB handoff

The public schema and [generated database types](./types/database.ts) are the app's Supabase interface. Use the signed-in user's session token for student requests. The service role can bypass RLS. Keep its key on the server and restrict it to administrative tasks.

## Configuration

| App variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` from local `supabase status`, or the hosted project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Local `ANON_KEY`, or the hosted project's public client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only administrative key |
| `OPTIMIZER_URL` | Optimizer base URL for the web server |
| `DIGREE_MOCK` | Web app mock-mode switch |

See [README.md](./README.md) for local start, reset, tests and demo accounts. To regenerate the public types from a running local database in PowerShell:

```powershell
$types = npx --yes supabase@3.1.0 gen types typescript --schema public
if ($LASTEXITCODE -ne 0) { throw 'Type generation failed' }
[IO.File]::WriteAllLines((Join-Path (Get-Location) 'supabase/types/database.ts'), [string[]]$types)
npx --yes prettier@3.6.2 --write supabase/types/database.ts
```

## Tables and permissions

| Tables | Keys and integration | Client permissions |
| --- | --- | --- |
| `terms`, `colleges`, `academic_programs` | `terms.id` is a term code. At most one term has `is_current=true`. Filter programs by `college_id` and `catalog_year`. | Public read only. |
| `academic_profiles` | Upsert on `user_id` with `college_id`, `program_id` and `catalog_year` from the same program row. | Owner select, insert, update. |
| `courses`, `buildings` | Text catalog IDs. Courses expose `code`, `title`, `credit_options`, `breadth`, `repeatable`, `source`, `fetched_at`. Titles and building names can be null. | Signed-in read. Service role maintains the catalog. |
| `section_bundles`, `meetings`, `walking_edges` | Bundle identity is `(term, course_id, bundle_id)`. Meetings use campus-local minute integers. An asynchronous bundle has zero meeting rows. An edge is keyed by `(from_building_id, to_building_id)`. Store minutes and direction explicitly. | Signed-in read. Service role maintains the catalog. |
| `course_grade_stats` | Join to `courses.id` by `course_id`. For optimizer `grade_stats`, send `a_ab_rate` and `sample_size`. Missing aggregates map to null. Coverage and source URL are available for display. | Signed-in read. Service role maintains aggregate data. |
| `course_requisites` | Read by `(term, course_id)`. Stores UW enrollment and advisory text, source, fetch time, and the source map of requirement-group IDs to class numbers. | Signed-in read. Service role maintains catalog data. |
| `user_course_records`, `grade_entries`, `degree_progress` | Course attempt uses a UUID `id` and optional `bundle_id`. Upsert grades by `record_id`. Degree progress is keyed by `(user_id, program_id, requirement_id)`. | Owner CRUD. GPA calculations use owner-visible grades and course records. |
| `saved_schedules`, `saved_schedule_items` | Schedule has a UUID `id`, owner, term, mode and name. Include `term` in item writes. Items are keyed by `(schedule_id, course_id)` and require a bundle from the same term and course. | Owner CRUD. Accepted friends with `full` permission can read both tables. |
| `friendships`, `schedule_permissions` | One request per unordered pair. Requester creates `pending`. Receiver accepts. Either participant may block with `blocked_by` set to their own UUID. The blocker removes a blocked friendship. Share per `(owner_id, viewer_id)`. | Participants read and manage their side of the friendship. Permission rows are owner-only. |
| `posts`, `comments` | Use `community_posts` and `community_comments`. Both include the generated `public_alias` and exclude account IDs. | Signed-in read. Authors can write and edit their own content. A block hides posts and comments between the two accounts. |
| `post_reports`, `user_blocks` | Report with `post_id` and `reason`. Block with `blocked_id`. | Anyone can submit a post report. Service role reads reports. Blockers read, create and delete their own blocks. |
| `chat_rooms`, `chat_memberships` | One room per `(term, course_id)`. Join via RPC to reserve an alias. | Read rooms only while eligible. A participant can read their own safe membership fields. |
| `chat_messages`, `chat_reports` | Message has `id`, `room_id`, `alias`, `body`, `created_at`. Report with `message_id` and `reason`. | Eligible room users read messages, send with their own alias and submit reports. Service role reads reports. |

## Enums

- `course_record_status` is `planned`, `enrolled_self_reported`, `completed` or `withdrawn`. A plan does not register a student. Self-reported enrollment is unverified.
- `schedule_mode` is `planned` or `enrolled_self_reported`. Save optimizer output as `planned`.
- `academic_data_source` is `manual`, `dars_pdf` or `dig`. `degree_review_status` is `manual`, `dars_pdf` or `unverified`.
- `letter_grade` is `A`, `AB`, `B`, `BC`, `C`, `D` or `F`. Missing grades are null.
- `meeting_day` is `MON`, `TUE`, `WED`, `THU`, `FRI`, `SAT` or `SUN`. `meeting_mode` is `in_person`, `hybrid` or `online_sync`.
- `seat_status` is `open`, `full` or `unknown`.
- `friendship_status` is `pending`, `accepted` or `blocked`. `visibility` is `private`, `free_busy` or `full`.

## Views and RPCs

- `community_posts` and `community_comments` are writable views that apply the caller's RLS. Send only `course_id`, `category`, `body` for a post and `post_id`, `body` for a comment. The DB assigns author and alias. An alias identifies one post or comment.
- `schedule_visibility(owner, viewer)` resolves visibility for the signed-in caller. Pass their UUID as `viewer`. `can_view_schedule(owner, viewer)` checks access to the complete schedule. `schedule_free_busy(schedule_owner, schedule_term, requested_mode)` returns distinct `day`, `start_min`, `end_min` blocks across the owner's schedules for that term and mode. It returns an empty set without access. Changing or deleting a permission takes effect immediately. Removing an accepted friendship also removes access. A stored permission can apply again if the pair later becomes friends.
- `my_chat_rooms()` returns `room_id`, `term`, `course_id`, `course_code`, `title`, `participant_count` and `my_alias` in course-code order. The count includes joined members with a current qualifying record. `my_alias` is null until the user joins, even if the generated RPC type infers it as a string. The room title falls back to the course code.
- `is_room_member(room_id)` checks current-term `enrolled_self_reported` eligibility. `join_chat_room(room_id)` checks eligibility and returns the user's stable alias for that room. To send, insert `room_id`, `alias` and `body` into `chat_messages`. Subscribe to new rows with a `room_id` filter and a user session. Withdrawal or a change of term removes room, message and send access through RLS.
- Reports are insert-only for clients. Use an insert without a returning selection.

## Data boundaries

- Build optimizer requests server-side from approved catalog fields and normalized constraints. Exclude user IDs, email, GPA, grades, DARS PDFs and chat text.
- The local seed catalog and programs are synthetic demo data. The academic source and review fields record provenance without implying university confirmation.
- The local deployment uses migrations in `supabase/migrations`. For an approved hosted deployment, inspect the destination schema and migration history, then link the project and review `supabase db push --dry-run` before applying migrations. Keep synthetic seed data local unless the target is explicitly intended for demo data.

## UW data integration

The cloud catalog includes UW public search data for Spring 2027 (term `1274`). Use this term for planning. Use `2027SP` for local fixture demos. Read `section_bundles` filtered by the selected term and match its `meetings` on all three key columns. A course can appear in the catalog before its bundles or historical grade aggregates are available. Leave course eligibility at `unknown` when there is no confirmed result.

Historical grade aggregates come from MadEnroll. They describe past letter grades across the provider's reported coverage, so display the range and sample size with the ratio. See [README.md](./README.md) for the term importer.

As of November 15, 2026, Fall 2026 (term `1272`) is current and has 4,885 course chat rooms sourced from UW public course search. The Fall import covers the course list. Section bundles and walking estimates are available for Spring 2027. The hosted profile catalog has 9 schools and colleges and 199 undergraduate degree listings from the [2026–2027 UW Guide](https://guide.wisc.edu/explore-majors/). The Spring 2027 catalog contains 9,312 directed walking estimates across 97 routable buildings. The OFF CAMPUS location has no exact address, and SPORTS CTR identifies the demolished Camp Randall Memorial Sports Center. Their pairs remain unknown.

The local fixture includes a synthetic walking matrix. For the live UW catalog, filter `walking_edges` by the building IDs in the request, paginate through all matches, and forward the stored directions and minutes. Estimates come from OpenStreetMap pedestrian paths using Valhalla. A missing pair is unknown and needs review. Display [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright) with the estimates. RMP ratings require an authorized source, so live `instructor_score` is null.
