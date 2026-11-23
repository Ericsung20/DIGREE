# DIG improvements on db_fix

Merged `origin/feature/dig-improvements` at `0fed60d` into `db_fix` after `f3a149e`. The merge keeps the feature branch's optimizer and OpenAPI changes intact and adapts its server queries to the shared database interfaces.

The combined behavior includes:

- Automatic course selection without must-takes, online filtering, grade/relevance/known-easy ranking, maximum-credit preference and distinct course-set recommendations.
- Preview paging through compatible timetable/section combinations, saving the displayed combination through the existing atomic `save_schedule` RPC.
- Direct section selection and batch entry of courses taken in past terms, with canonical cross-list search/display retained.
- `planner_courses`, `course_attempts`, unified selected majors, owner-only transfer evidence and term-specific `course_offerings`.
- Transfer equivalents satisfy alias-based prerequisites and stay out of optional recommendations unless the offering is repeatable. Alias-based program relevance includes additional majors, even when the term's requisite row lacks the alias.

Three files needed textual conflict resolution: course addition, DIG request construction and its server test. The merged candidate path also needed term snapshots and transfer exclusion applied before ranking, plus canonical aliases for the full optional pool. Snapshot/alias reads use bounded parallel batches. A browser check found that a 5:30 PM relaxation was absent from the hour selector; current half-hour choices are now retained.

Existing signup safeguards, program requirements, simplified transfer entry, owner policies and sharing behavior remain in `db_fix`. This integration introduces no database migration or shared-data writes. The hosted migration preflight found no pending migrations. Docker remains stopped.

Validation:

- 78 web tests, including three merge regressions and both actual optimizer integration cases against a temporary baseline server.
- 299 optimizer tests; the feature branch's optimizer and contract trees are unchanged.
- OpenAPI type regeneration, TypeScript, ESLint and production build.
- Live API acceptance of the added scoring/credit-preference fields with distinct course-set mode enabled.
- Authenticated shared-DB browser run: 5 recommendations at 14 credits, preview of 10 compatible timetables, and a successful switch to the second combination. No plan was planted; the original day/hour preferences were restored after testing.

Use `DIGREE_DISTINCT_COURSE_SETS=1` for normal DIG development. Exact fixture comparison uses `0` on a separate test server. See [shared development](shared-development.md) for both developers' startup commands.
