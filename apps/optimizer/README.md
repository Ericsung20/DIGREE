# DIGREE Optimizer

Standalone scheduling optimization API for DIGREE. It receives normalized, anonymized course data and returns the top-ranked feasible schedules. It calls no external service, reads no database and stores nothing; the same request always produces the same response.

- Contract: `contracts/openapi.yaml` (v1.0)
- Reference request and response: `fixtures/request.json`, `fixtures/expected.json`
- Status: **Milestone B** (required-course schedules, all hard constraints, unknown-data handling, warnings, diagnostics)

Nothing in a response is a university verification. `ready` means the optimizer found no problem in the data it was given, not that enrollment is assured.

## Setup

Requires Python 3.12 or newer. From `apps/optimizer/`:

```bash
python3.13 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
```

There are no environment variables.

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
| `tests/test_contract.py` | Fixture request to expected response, models against the OpenAPI file, 422 and 503 bodies, unknown-data scenarios over HTTP |
| `tests/test_constraints.py` | H1-H10: time window, blocked days, overlap, walking, credits, eligibility, full sections, diagnostics |
| `tests/test_unknown_data.py` | `needs_review`, warnings, meeting modes, missing buildings and walking times, wording |
| `tests/test_ranking.py` | Score formulas, scoring with unknown walks, Top K, tie-breaking, reproducibility |

## Code layout

| File | Role |
|---|---|
| `app/main.py` | Routes and error mapping |
| `app/models.py` | Pydantic models mirroring the contract, plus cross-field validation |
| `app/engine.py` | Search, hard constraints, unknown-data handling, diagnostics |
| `app/scoring.py` | Score formulas and the ranking key |
| `app/messages.py` | Every code and sentence the API emits |

## Responses

| Status | When | Body |
|---|---|---|
| 200 | The search ran. `results` may be empty; that is a normal answer, explained in `diagnostics`. | `GenerateResponse` |
| 422 | The request is malformed or internally inconsistent. | `{"error": {"code": "validation_error", "message", "details"}}` |
| 503 | The request needs behaviour that is not built yet (`not_implemented`), or the optimizer failed unexpectedly (`internal_error`). | `{"error": {"code", "message", "details"}}` |

Every `details` entry has the form `<path>: <message>`, for example `courses[0].section_bundles[1].meetings[0]: start_min must be less than end_min`.

Beyond the OpenAPI schema, these are rejected with 422:

- `start_min` not less than `end_min`
- `min_credits` greater than `max_credits`
- duplicate `course_id`, or duplicate `bundle_id` within one course
- duplicate entries in `blocked_days`
- all six weights equal to 0
- two walking edges that give different minutes for the same directed pair, or a non-zero walking time from a building to itself
- unknown fields, and values of the wrong JSON type (`"10"` or `10.0` where an integer is required)

## Hard constraints

Schedules are built from the **required** courses: one section bundle and one credit option per course.

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

**Diagnostics.** `explored_combinations` counts complete combinations (one bundle and one credit option for every required course). When the search abandons a partial selection, every combination beneath it is counted. Each rejected combination is counted once, under the first check it fails in the order above. Keys with a count of 0 are omitted.

**`no_results_reasons`** is filled only when `results` is empty. It holds bare codes in this order:

1. `required_course_ineligible`
2. `required_course_already_completed`
3. `required_course_without_bundles` (a required course has an empty `section_bundles` list)
4. the `rejected_by_reason` keys that occurred, in the order of the table above

## Meeting modes

| Mode | Treated as |
|---|---|
| `in_person` | A class in `building_id` |
| `hybrid` | Exactly like `in_person` |
| `online_sync` | A class at a fixed time with no location; `building_id` is ignored |

All modes obey the time window, blocked days and overlap checks. `campus_days` counts days with at least one in-person or hybrid meeting. A bundle with `meetings: []` is asynchronous: it adds credits and nothing else.

## Unknown data: `needs_review` and warnings

The optimizer never fills a gap in the data with a guess. A schedule that depends on something unknown is still returned, with `status: needs_review` and a warning for each open question.

Every warning is one string, `<code>: <message>`. Split on the first `": "` to get the code. Warnings are listed in the order of this table, then in request order.

| Code | Raised when the selected schedule has |
|---|---|
| `eligibility_unknown` | a course with `eligibility_status: unknown` |
| `seat_status_unknown` | a bundle with `seat_status: unknown` |
| `section_full_included` | a bundle with `seat_status: full` (only possible while `exclude_full_sections` is false) |
| `building_unknown` | an in-person or hybrid meeting with no `building_id` |
| `walking_time_unknown` | two consecutive classes in different buildings with no walking edge for that direction |
| `location_uncertain` | an online meeting directly before or after an in-person or hybrid one on the same day |

All six currently make the result `needs_review`. That is a property of these codes, not of warnings in general: a later advisory warning may leave a result `ready`, so clients should read `status` rather than test whether `warnings` is empty.

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

## Score and ranking

`score = 100 * sum(weight * component) / sum(weight)` over the factors below, rounded to 2 decimals.

| Weight | Component |
|---|---|
| `walking` | `exp(-walking_minutes_weekly / 30)` |
| `idle_gap` | `exp(-idle_gap_minutes_weekly / 60)` |
| `campus_days` | `1 - (campus_days - 1) / 4`, limited to 0..1 |

**Schedules with unknown walks** are not scored on their subtotals, which would treat every unknown walk as free. Instead:

1. Take the neutral value: the median `walking_minutes_weekly` of the schedules in this response whose travel data is complete. If there are none, use the amount of walking that scores exactly half (about 20.8 minutes).
2. Assume the schedule walks that much in total, but no less than its known walking and no more than its unchecked gaps allow (each gap less the buffer, and no more than the walk maximum).
3. Take the assumed extra walking out of the idle time between the same classes.

The score therefore always equals the score of one real, feasible week. The reported metrics stay as known subtotals.

**Ranking.** `ready` before `needs_review`, then higher rounded score, then ascending `(course_id, bundle_id, credits)`. The first `top_k` are returned with `rank` starting at 1. `selected` and `meetings` keep the order of the request.

**`reasons`.**

| Result | Text |
|---|---|
| `ready` | `All selected courses fit; weekly between-class walking: N min.` |
| `needs_review`, every transition checked | `Class times do not overlap and every between-class walk was checked; weekly between-class walking: N min.` then `Review the warnings before enrolling.` |
| `needs_review`, some transitions unchecked | `Class times do not overlap, but travel between some classes could not be checked.` then `Walking and idle-gap figures count known transitions only; known weekly between-class walking: N min.` then `Review the warnings before enrolling.` |

## Not implemented yet

A request that depends on any of the following gets **503 `not_implemented`**, with the offending fields listed in `details`. Nothing is silently ignored.

| The request contains | Planned for |
|---|---|
| `grade_outcomes`, `degree_fit` or `instructor` weight above 0 | Milestone C |
| Required courses that cannot reach the credit range without optional courses | Milestone C |
| No required course at all | Milestone C |

Optional courses (`is_required: false`) are never selected yet. When the required courses already satisfy the credit range, optional courses and their data have no effect on the response, so such requests are answered normally.

Also not built yet: a search cap (`search_truncated` is always `false`) and the Dockerfile (Milestone D).

## Assumptions to confirm

These small rules are not stated in the handoff or contract. They are implemented as described and can be changed.

- **The walking buffer applies within one building.** `gap >= walk + buffer` is applied literally, so two back-to-back classes in the same building are rejected when the buffer is above 0.
- **The buffer is not applied next to an online meeting**, and not between two online meetings.
- **An online meeting between two in-person ones hides the walk between them.** Both of its transitions are unchecked, and the walk between the two buildings is neither checked nor counted.
- **Repeated values in `credit_options` are collapsed**, so `[3, 3]` behaves like `[3]`.
- **The campus-days component is capped at 1.** The handoff formula gives 1.25 for a schedule with no campus days, which would push the score above 100.
- **Which key a rejection is counted under can depend on search order.** Totals do not. Courses are searched fewest bundles first, with ties in request order.
