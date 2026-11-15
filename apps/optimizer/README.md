# DIGREE Optimizer

Standalone scheduling optimization API for DIGREE. It receives normalized, anonymized course data and returns the top-ranked feasible schedules. It calls no external service, reads no database and stores nothing; the same request always produces the same response.

- Contract: `contracts/openapi.yaml` (v1.0)
- Reference request and response: `fixtures/request.json`, `fixtures/expected.json`
- Status: **Milestone A** (contract, required-course section selection, walking-based ranking)

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
| `tests/test_contract.py` | Fixture request to expected response, models against the OpenAPI file, 422 and 503 bodies |
| `tests/test_constraints.py` | Time window, blocked days, overlap, walking feasibility, credits, metrics, diagnostics |
| `tests/test_ranking.py` | Score formulas, Top K, tie-breaking, reproducibility |

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

## What Milestone A does

It builds schedules from the **required** courses: one section bundle and one credit option per course.

| Check | `rejected_by_reason` key |
|---|---|
| Total credits within `min_credits`..`max_credits` | `credits_out_of_range` |
| Every meeting within `earliest_start_min`..`latest_end_min` | `outside_time_window` |
| No meeting on a blocked day | `blocked_day` |
| No two meetings overlap on the same day (`[start, end)` intervals) | `time_overlap` |
| Between consecutive classes, `gap >= walk + walking_buffer_min` | `insufficient_walk_time` |
| No single walk longer than `max_walk_per_transition_min` | `walk_exceeds_max` |

**Diagnostics.** `explored_combinations` counts complete combinations (one bundle and one credit option for every required course). When the search abandons a partial selection, every combination beneath it is counted. Each rejected combination is counted once, under the first check it fails in the order above. Keys with a count of 0 are omitted.

**Metrics.** For each day, meetings are sorted by start time and each consecutive pair is one transition. `walking_minutes_weekly` is the sum of walking minutes over all transitions (0 within one building). `idle_gap_minutes_weekly` is the sum of `gap - walk`; the buffer is not subtracted. `campus_days` is the number of days with at least one meeting.

**Score.** `100 * sum(weight * component) / sum(weight)` over the factors below, rounded to 2 decimals.

| Weight | Component |
|---|---|
| `walking` | `exp(-walking_minutes_weekly / 30)` |
| `idle_gap` | `exp(-idle_gap_minutes_weekly / 60)` |
| `campus_days` | `1 - (campus_days - 1) / 4`, limited to 0..1 |

**Ranking.** `ready` before `needs_review`, then higher rounded score, then ascending `(course_id, bundle_id, credits)`. The first `top_k` are returned with `rank` starting at 1. `selected` and `meetings` keep the order of the request.

## Not implemented yet

A request that depends on any of the following gets **503 `not_implemented`**, with the offending fields listed in `details`. Nothing is silently ignored.

| The request contains | Planned for |
|---|---|
| `grade_outcomes`, `degree_fit` or `instructor` weight above 0 | Milestone C |
| Required courses that cannot reach the credit range without optional courses | Milestone C |
| No required course at all | Milestone C |
| A required course with `eligibility_status` of `unknown` or `ineligible` | Milestone B |
| A required course that is `already_completed` and not `repeatable` | Milestone B |
| A required course's bundle with `seat_status: unknown` | Milestone B |
| A required course's bundle with `seat_status: full` while `exclude_full_sections` is true | Milestone B |
| A required course's meeting with mode `hybrid` or `online_sync`, or with no `building_id` | Milestone B |
| A schedule that passes every other check but needs a walking time missing from `walking_edges` | Milestone B |

Optional courses (`is_required: false`) are never selected in Milestone A. When the required courses already satisfy the credit range, optional courses and their data have no effect on the response, so such requests are answered normally.

Also not built yet: `needs_review` results and `warnings` (always `ready` and `[]`), a search cap (`search_truncated` is always `false`), and the Dockerfile (Milestone D).

## Assumptions to confirm

These small rules are not stated in the handoff or contract. They are implemented as described and can be changed.

- **`no_results_reasons` is provisional.** When `results` is empty it lists the `rejected_by_reason` keys that occurred, in check order, plus `required_course_without_bundles` when a required course has an empty `section_bundles` list. The final vocabulary is a Milestone B decision.
- **The walking buffer applies within one building.** `gap >= walk + buffer` is applied literally, so two back-to-back classes in the same building are rejected when the buffer is above 0.
- **Repeated values in `credit_options` are collapsed**, so `[3, 3]` behaves like `[3]`.
- **The campus-days component is capped at 1.** The handoff formula gives 1.25 for a schedule with no campus days, which would push the score above 100.
- **Which key a rejection is counted under can depend on search order.** Totals do not. Courses are searched fewest bundles first, with ties in request order.
