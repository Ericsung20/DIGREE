# DIGREE Optimizer

Standalone scheduling optimization API for DIGREE. It receives normalized, anonymized course data and returns the top-ranked feasible schedules. It calls no external service, reads no database and stores nothing; the same request always produces the same response.

- Contract: `contracts/openapi.yaml` (v1.0)
- Reference request and response: `fixtures/request.json`, `fixtures/expected.json`
- Status: **Milestone C** (optional-course selection, all six scoring factors, search limits; on top of the hard constraints and unknown-data handling)

Nothing in a response is a university verification. `ready` means the optimizer found no problem in the data it was given, not that enrollment is assured.

## Setup

Requires Python 3.12 or newer. From `apps/optimizer/`:

```bash
python3.13 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
```

## Configuration

Two optional environment variables bound the search. They are read once at startup; an invalid value stops the service with an error naming the variable.

| Variable | Default | Allowed | Meaning |
|---|---|---|---|
| `DIGREE_MAX_SEARCH_STEPS` | `100000` | 1 to 10,000,000 | Search steps per request before the search stops |
| `DIGREE_MAX_OPTIONAL_COURSES` | `20` | 1 to 200 | Optional courses considered per request |

A step is one section placement or one schedule evaluation. Limits count steps, not seconds, so the same request and limits give the same response on any machine. At the default, the slowest request measured took under one second.

## Run

```bash
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Interactive docs are served at `http://127.0.0.1:8000/docs`.

```bash
curl -s http://127.0.0.1:8000/health

curl -s -X POST http://127.0.0.1:8000/v1/schedules/generate \
  -H 'Content-Type: application/json' \
  --data-binary @../../fixtures/request.json
```

The second command returns exactly the content of `fixtures/expected.json`.

## Test

```bash
.venv/bin/python -m pytest
```

| File | Covers |
|---|---|
| `tests/test_contract.py` | Fixture request to expected response, models against the OpenAPI file, 422 and 503 bodies, scenarios over HTTP |
| `tests/test_constraints.py` | H1-H10: time window, blocked days, overlap, walking, credits, eligibility, full sections, diagnostics |
| `tests/test_unknown_data.py` | `needs_review`, review warnings, meeting modes, missing buildings and walking times, wording |
| `tests/test_optional_courses.py` | When optional courses are added, which are usable, variable credits, no required courses, counts |
| `tests/test_scoring_factors.py` | Grade smoothing, degree fit, instructor, missing data, factors left out, advisory warnings |
| `tests/test_search_limits.py` | Step cap, shortlist, truncation diagnostics, configuration |
| `tests/test_ranking.py` | Shape-factor formulas, scoring with unknown walks, Top K, tie-breaking, reproducibility |

## Code layout

| File | Role |
|---|---|
| `app/main.py` | Routes and error mapping |
| `app/models.py` | Pydantic models mirroring the contract, plus cross-field validation |
| `app/engine.py` | Course and section search, hard constraints, unknown-data handling, diagnostics |
| `app/scoring.py` | Score formulas, neutral values and the ranking key |
| `app/config.py` | Search limits and their environment variables |
| `app/messages.py` | Every code and sentence the API emits |

## Responses

| Status | When | Body |
|---|---|---|
| 200 | The search ran. `results` may be empty; that is a normal answer, explained in `diagnostics`. | `GenerateResponse` |
| 422 | The request is malformed or internally inconsistent. | `{"error": {"code": "validation_error", "message", "details"}}` |
| 503 | The optimizer failed unexpectedly (`internal_error`). | `{"error": {"code", "message", "details"}}` |

Every `details` entry has the form `<path>: <message>`, for example `courses[0].section_bundles[1].meetings[0]: start_min must be less than end_min`.

Beyond the OpenAPI schema, these are rejected with 422:

- `start_min` not less than `end_min`
- `min_credits` greater than `max_credits`
- duplicate `course_id`, or duplicate `bundle_id` within one course
- duplicate entries in `blocked_days`
- all six weights equal to 0
- two walking edges that give different minutes for the same directed pair, or a non-zero walking time from a building to itself
- unknown fields, and values of the wrong JSON type (`"10"` or `10.0` where an integer is required)

## Which courses a schedule contains

Every schedule holds **all required courses**, each with one section bundle and one credit option.

**Optional courses** (`is_required: false`) are added only when the required courses cannot reach the credit range on their own, that is, when no combination of their credit options lands inside `min_credits..max_credits`. Then every set of usable optional courses whose total lands inside the range is a candidate: with 9 required credits and a 12-18 range, schedules of 12, 15 and 18 credits are all eligible. When the required courses already fit the range, optional courses are not considered at all.

An optional course is usable unless it is `ineligible`, `already_completed` and not `repeatable`, or has no section bundles. One with `eligibility_status: unknown` is usable, and a schedule containing it is `needs_review`.

With **no required course**, schedules are built from optional courses alone. A schedule always contains at least one course, and the range is applied as given: with `max_credits: 0` nothing fits and `results` is empty.

A course with several `credit_options` yields one schedule per option that fits.

## Hard constraints

| Check | `rejected_by_reason` key |
|---|---|
| Total credits within `min_credits`..`max_credits` | `credits_out_of_range` |
| Bundle is `full` while `exclude_full_sections` is true | `section_full` |
| Every meeting within `earliest_start_min`..`latest_end_min` | `outside_time_window` |
| No meeting on a blocked day | `blocked_day` |
| No two meetings overlap on the same day (`[start, end)` intervals) | `time_overlap` |
| Between consecutive classes, `gap >= walk + walking_buffer_min` | `insufficient_walk_time` |
| No single walk longer than `max_walk_per_transition_min` | `walk_exceeds_max` |

A required course that is `ineligible`, or `already_completed` and not `repeatable`, rules out every schedule: the response has `results: []`, nothing is explored, and `no_results_reasons` says why.

**Diagnostics.** A combination settles every course in the search: a bundle and a credit option for each required course, and for each optional course either a bundle and a credit option or leaving it out. Selecting no course at all is not a combination. `explored_combinations` counts the combinations examined; when the search abandons a partial selection, every combination beneath it is counted. Each rejected combination is counted once, under the first check it fails in the order above. Keys with a count of 0 are omitted.

With optional courses the number grows quickly, because each one multiplies the combinations. It measures the size of the search, not the number of results, and for very large requests it can exceed the range JavaScript represents exactly (2^53).

**`no_results_reasons`** is filled only when `results` is empty. It holds bare codes in this order:

1. `search_truncated` (the search stopped at a limit; a schedule may still exist)
2. `required_course_ineligible`
3. `required_course_already_completed`
4. `required_course_without_bundles` (a required course has an empty `section_bundles` list)
5. `no_usable_optional_courses` (optional courses were needed and none was usable)
6. the `rejected_by_reason` keys that occurred, in the order of the table above

## Meeting modes

| Mode | Treated as |
|---|---|
| `in_person` | A class in `building_id` |
| `hybrid` | Exactly like `in_person` |
| `online_sync` | A class at a fixed time with no location; `building_id` is ignored |

All modes obey the time window, blocked days and overlap checks. `campus_days` counts days with at least one in-person or hybrid meeting. A bundle with `meetings: []` is asynchronous: it adds credits and nothing else.

## Warnings

Every warning is one string, `<code>: <message>`. Split on the first `": "` to get the code. A result lists its review warnings first, then its advisory warnings, each group in the order of its table and then in request order.

**Review warnings** are open questions about whether the schedule can be taken. Any one of them makes the result `needs_review`. The optimizer never fills a gap in the data with a guess; it returns the schedule and says what is unknown.

| Code | Raised when the selected schedule has |
|---|---|
| `eligibility_unknown` | a course with `eligibility_status: unknown` |
| `seat_status_unknown` | a bundle with `seat_status: unknown` |
| `section_full_included` | a bundle with `seat_status: full` (only possible while `exclude_full_sections` is false) |
| `building_unknown` | an in-person or hybrid meeting with no `building_id` |
| `walking_time_unknown` | two consecutive classes in different buildings with no walking edge for that direction |
| `location_uncertain` | an online meeting directly before or after an in-person or hybrid one on the same day |

**Advisory warnings** describe how the result was scored or found. They never change the status, so a `ready` result can carry them. Read `status`; do not infer it from whether `warnings` is empty.

| Code | Meaning |
|---|---|
| `grade_data_missing` | A selected optional course has no grade statistics and took a neutral value; or no optional course has any, and the grade weight was not applied |
| `degree_fit_data_missing` | The same, for `requirement_fit` |
| `instructor_data_missing` | A selected section has no instructor rating and took a neutral value; or no section has one, and the instructor weight was not applied |
| `score_not_comparable` | No weighted factor can tell the schedules apart; every score is 50 and the order follows IDs |
| `search_incomplete` | The search stopped at a limit; better schedules may exist |

**Transitions the optimizer cannot check.** For each day, meetings are sorted by start time and each consecutive pair is one transition.

| Transition | Handling |
|---|---|
| Both in a known building, walking time known | Checked against the buffer and the walk maximum; counted in the metrics |
| Different buildings with no edge, or a building missing | Rejected as `insufficient_walk_time` if the gap is shorter than the buffer, since no walk takes less than 0 minutes. Otherwise kept as `needs_review`, unchecked |
| Online next to in-person or hybrid | Kept as `needs_review`, unchecked, whatever the gap |
| Online next to online | Nothing to check; the gap counts as idle time |

A schedule with an unchecked transition is still rejected if another, known transition fails.

## Metrics

- `walking_minutes_weekly`: the sum of walking minutes over transitions whose walking time is known (0 within one building).
- `idle_gap_minutes_weekly`: the sum of `gap - walk` over those same transitions; the buffer is not subtracted.
- `campus_days`: days with at least one in-person or hybrid meeting.

When a schedule has unchecked transitions, both walking figures are **subtotals over the known transitions only**. The result's `reasons` say so.

## Score

`score = 100 * sum(weight * value) / sum(weight)` over the factors being compared, rounded to 2 decimals. Every value is between 0 and 1.

| Weight | Data | Value |
|---|---|---|
| `walking` | meetings, `walking_edges` | `exp(-walking_minutes_weekly / 30)` |
| `idle_gap` | meetings | `exp(-idle_gap_minutes_weekly / 60)` |
| `campus_days` | meetings | `1 - (campus_days - 1) / 4`, limited to 0..1 |
| `grade_outcomes` | `grade_stats` | mean smoothed A/AB rate of the selected **optional** courses |
| `degree_fit` | `requirement_fit` | mean over the selected **optional** courses |
| `instructor` | `instructor_score` | mean over **every** selected section |

**Grade smoothing.** A course's rate is `(n * a_ab_rate + 25) / (n + 50)` with `n = sample_size`: each course is treated as if it came with 50 extra grades at a 50% rate. Two grades at 100% give 0.52; 400 grades at 80% give 0.77. `grade_stats: null` and `sample_size: 0` both count as no data. This is an MVP rule, not a university statistic, and says nothing certain about the grade a student will get.

**Missing values are never scored as 0.** A course or section without data takes the median of the known values among everything the request could select (the usable optional courses, or all selectable sections). The result carries an advisory warning naming what was missing.

**A data-driven factor is left out of the average** when it cannot tell schedules apart:

- the request has no data for it at all (an advisory warning says the weight was not applied);
- fewer than two different values are known, so every schedule would get the same value;
- for `grade_outcomes` and `degree_fit`, no optional course is in play;
- for `instructor` when the courses are fixed, no course has two sections with different ratings.

The three shape factors are always compared. If nothing is left to compare, every schedule scores 50 with a `score_not_comparable` warning.

All of this is decided from the request before the search starts. A schedule's score therefore does not depend on which other schedules were found, on `top_k`, or on the search limits.

**Schedules with unknown walks.** No number of minutes is ever made up for a missing walking time. When a schedule has unchecked transitions:

- its `walking` and `idle_gap` values are a neutral 0.5;
- unless its known walking or idle time alone already scores below 0.5, in which case that lower value is used, because the real total can only be higher than the known part.

The limits of this rule: 0.5 is a placeholder, not an estimate. It corresponds to about 21 minutes of weekly walking, whatever the real distance is and however many walks are unknown. A schedule whose unknown walk is in fact short is under-scored, and one whose unknown walk is long is over-scored. Such schedules are always `needs_review` and always rank below every `ready` schedule, so the placeholder only orders them among other schedules that also need review.

**Ranking.** `ready` before `needs_review`, then higher rounded score, then ascending `(course_id, bundle_id, credits)`. The first `top_k` are returned with `rank` starting at 1. `selected` and `meetings` keep the order of the request.

**`reasons`.**

| Result | Text |
|---|---|
| `ready` | `All selected courses fit; weekly between-class walking: N min.` |
| `needs_review`, every transition checked | `Class times do not overlap and every between-class walk was checked; weekly between-class walking: N min.` then `Review the warnings before enrolling.` |
| `needs_review`, some transitions unchecked | `Class times do not overlap, but travel between some classes could not be checked.` then `Walking and idle-gap figures count known transitions only; known weekly between-class walking: N min.` then `Review the warnings before enrolling.` |

## Search

The search is one depth-first pass: required courses first (fewest sections first, ties in request order), then the optional pool (highest `requirement_fit` first, missing values last, ties by `course_id`). For each optional course it tries every section and credit option, then leaving the course out.

Branches are cut as early as possible: when the credits already chosen plus the least still to come exceed the maximum, when even everything still available cannot reach the minimum, when a section breaks a rule on its own, or when it overlaps a section already chosen. Walking is judged only on complete schedules, because two classes that are neighbours in a partial schedule may not stay neighbours.

Two limits keep large requests bounded (see Configuration):

- **Step cap.** The search stops after `DIGREE_MAX_SEARCH_STEPS` steps.
- **Shortlist.** Only the first `DIGREE_MAX_OPTIONAL_COURSES` usable optional courses, in the pool order above, are searched.

When either limit leaves combinations unexamined:

- `diagnostics.search_truncated` is `true`;
- every result carries the `search_incomplete` advisory warning;
- `explored_combinations` counts only what was examined;
- the results are the best found, not necessarily the best that exist;
- an empty `results` lists `search_truncated` first in `no_results_reasons`, because no schedule having been found is not proof that none exists.

## Not implemented yet

- **No variety rule for the top K.** The top results can all be one set of courses with different sections.
- **No Dockerfile** (Milestone D).

## Assumptions to confirm

These small rules are not stated in the handoff or contract. They are implemented as described and can be changed.

- **The walking buffer applies within one building.** `gap >= walk + buffer` is applied literally, so two back-to-back classes in the same building are rejected when the buffer is above 0.
- **The buffer is not applied next to an online meeting**, and not between two online meetings.
- **An online meeting between two in-person ones hides the walk between them.** Both of its transitions are unchecked, and the walk between the two buildings is neither checked nor counted.
- **Repeated values in `credit_options` are collapsed**, so `[3, 3]` behaves like `[3]`.
- **`reasons` name the optional courses.** A schedule with optional courses adds the sentence `Optional courses selected: A, B.` to its `reasons`.
- **A missing `requirement_fit` puts a course last in the pool order**, so with more usable optional courses than the shortlist allows, courses without a fit value are the first to be left out.
- **The campus-days component is capped at 1.** The handoff formula gives 1.25 for a schedule with no campus days, which would push the score above 100.
- **Which key a rejection is counted under can depend on search order.** Totals of a complete search do not.
- **A truncated search can depend on request order** among required courses with the same number of sections, because that tie follows the request.
