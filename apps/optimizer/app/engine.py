"""Pure optimization core: deterministic backtracking with pruning.

No I/O, no clock, no randomness: the same request always yields the same
response. The engine builds schedules from the required courses, enforces the
hard constraints, and marks schedules that rest on unknown data as
needs_review instead of guessing. Optional-course selection and the
data-driven scoring factors are not built yet; a request that needs them
raises UnsupportedFeatureError rather than getting a response that ignores
part of it.
"""

from collections import Counter
from dataclasses import dataclass, replace
from itertools import pairwise
from math import prod

from app import CONTRACT_VERSION, messages
from app.messages import REJECTION_REASONS
from app.models import (
    CandidateCourse,
    Diagnostics,
    GenerateRequest,
    GenerateResponse,
    Meeting,
    Metrics,
    ScheduleResult,
    SectionBundle,
    SelectedBundle,
    walking_minutes_by_pair,
)
from app.scoring import (
    UNIMPLEMENTED_FACTORS,
    UnknownTravel,
    neutral_walking_minutes,
    ranking_key,
    schedule_score,
)

DAY_ORDER = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


class UnsupportedFeatureError(Exception):
    """The request needs behaviour that is not implemented yet."""

    def __init__(self, details: list[str]):
        super().__init__("; ".join(details))
        self.details = details


@dataclass(frozen=True)
class _Slot:
    """One required course as the search sees it."""

    request_index: int
    course: CandidateCourse
    credit_options: tuple[int, ...]
    bundle_violations: tuple[str | None, ...]  # aligned with course.section_bundles


@dataclass(frozen=True)
class _Choice:
    request_index: int
    course: CandidateCourse
    bundle: SectionBundle
    credits: int


@dataclass(frozen=True)
class _Candidate:
    choices: tuple[_Choice, ...]  # in request order
    metrics: Metrics
    warnings: tuple[str, ...]
    status: str
    unknown_travel: UnknownTravel | None  # set when the metrics are known-transition subtotals
    score: float = 0.0

    def sort_key(self) -> tuple:
        selection = ((c.course.course_id, c.bundle.bundle_id, c.credits) for c in self.choices)
        return ranking_key(self.status, self.score, selection)


def generate(request: GenerateRequest) -> GenerateResponse:
    unsupported = find_unsupported_features(request)
    if unsupported:
        raise UnsupportedFeatureError(unsupported)

    required = [course for course in request.courses if course.is_required]
    blocking = _blocking_reasons(required)
    without_bundles = (
        [messages.REQUIRED_COURSE_WITHOUT_BUNDLES]
        if any(not course.section_bundles for course in required)
        else []
    )
    if blocking:
        # A required course that cannot be taken rules out every schedule.
        return _response(
            request,
            [],
            Diagnostics(
                explored_combinations=0,
                rejected_by_reason={},
                search_truncated=False,
                no_results_reasons=blocking + without_bundles,
            ),
        )

    search = _Search(request)
    search.run()

    # Schedules with unknown travel are scored against the ones that are fully known.
    weights = request.preferences.weights
    neutral = neutral_walking_minutes(
        c.metrics for c in search.candidates if c.unknown_travel is None
    )
    scored = [
        replace(c, score=schedule_score(c.metrics, weights, c.unknown_travel, neutral))
        for c in search.candidates
    ]
    ranked = sorted(scored, key=_Candidate.sort_key)[: request.top_k]
    results = [_to_result(rank, candidate) for rank, candidate in enumerate(ranked, start=1)]

    occurred = [reason for reason in REJECTION_REASONS if search.rejected[reason] > 0]
    return _response(
        request,
        results,
        Diagnostics(
            explored_combinations=search.explored,
            rejected_by_reason={reason: search.rejected[reason] for reason in occurred},
            search_truncated=False,
            no_results_reasons=[] if results else without_bundles + occurred,
        ),
    )


def find_unsupported_features(request: GenerateRequest) -> list[str]:
    """List what the request needs that is not built yet, as '<path>: <message>'."""
    details: list[str] = []

    for factor in UNIMPLEMENTED_FACTORS:
        if getattr(request.preferences.weights, factor) > 0:
            details.append(
                f"preferences.weights.{factor}: scoring by {factor} is not implemented yet"
            )

    if not any(course.is_required for course in request.courses):
        details.append(
            "courses: no course is required; choosing among optional courses is not implemented yet"
        )
    elif _needs_optional_courses(request):
        details.append(
            "courses: required courses cannot reach the credit range on their own; "
            "filling credits with optional courses is not implemented yet"
        )
    return details


def _needs_optional_courses(request: GenerateRequest) -> bool:
    if all(course.is_required for course in request.courses):
        return False
    required_totals = {0}
    for course in request.courses:
        if course.is_required:
            required_totals = {
                total + credits for total in required_totals for credits in course.credit_options
            }
    constraints = request.constraints
    if any(constraints.min_credits <= total <= constraints.max_credits for total in required_totals):
        return False
    # Optional courses can only add credits, so they help only when some
    # required-course total still has room below the maximum.
    return min(required_totals) < constraints.max_credits


def _blocking_reasons(required: list[CandidateCourse]) -> list[str]:
    """H8: reasons a required course cannot be taken at all."""
    reasons = []
    if any(course.eligibility_status == "ineligible" for course in required):
        reasons.append(messages.REQUIRED_COURSE_INELIGIBLE)
    if any(course.already_completed and not course.repeatable for course in required):
        reasons.append(messages.REQUIRED_COURSE_ALREADY_COMPLETED)
    return reasons


class _Search:
    def __init__(self, request: GenerateRequest):
        self._constraints = request.constraints
        self._walk_minutes = walking_minutes_by_pair(request.walking_edges)

        slots = [
            _Slot(
                request_index=index,
                course=course,
                credit_options=tuple(sorted(set(course.credit_options))),
                bundle_violations=tuple(self._bundle_violation(b) for b in course.section_bundles),
            )
            for index, course in enumerate(request.courses)
            if course.is_required
        ]
        # Fewest bundles first; ties keep request order.
        self._slots = sorted(slots, key=lambda s: (len(s.course.section_bundles), s.request_index))

        # Per depth: how many complete combinations, and how many credits,
        # the courses from that depth onward can still contribute.
        count = len(self._slots)
        self._completions_from = [
            prod(len(s.course.section_bundles) * len(s.credit_options) for s in self._slots[d:])
            for d in range(count + 1)
        ]
        self._min_credits_from = [
            sum(s.credit_options[0] for s in self._slots[d:]) for d in range(count + 1)
        ]
        self._max_credits_from = [
            sum(s.credit_options[-1] for s in self._slots[d:]) for d in range(count + 1)
        ]

        self.explored = 0
        self.rejected: Counter[str] = Counter()
        self.candidates: list[_Candidate] = []

    def run(self) -> None:
        self._descend(0, 0, [])

    def _descend(self, depth: int, credits_so_far: int, chosen: list[_Choice]) -> None:
        if depth == len(self._slots):
            self._evaluate_complete(credits_so_far, chosen)
            return

        constraints = self._constraints
        slot = self._slots[depth]
        bundles = slot.course.section_bundles
        completions_below = self._completions_from[depth + 1]

        for credits in slot.credit_options:
            total = credits_so_far + credits
            if (
                total + self._min_credits_from[depth + 1] > constraints.max_credits
                or total + self._max_credits_from[depth + 1] < constraints.min_credits
            ):
                self._reject("credits_out_of_range", len(bundles) * completions_below)
                continue
            for bundle, violation in zip(bundles, slot.bundle_violations):
                if violation is None and any(
                    _bundles_overlap(bundle, choice.bundle) for choice in chosen
                ):
                    violation = "time_overlap"
                if violation is not None:
                    self._reject(violation, completions_below)
                    continue
                chosen.append(_Choice(slot.request_index, slot.course, bundle, credits))
                self._descend(depth + 1, total, chosen)
                chosen.pop()

    def _reject(self, reason: str, combinations: int) -> None:
        """Count every complete combination beneath a pruned selection."""
        self.explored += combinations
        self.rejected[reason] += combinations

    def _bundle_violation(self, bundle: SectionBundle) -> str | None:
        """Violations a bundle carries on its own, whatever it is combined with."""
        constraints = self._constraints
        if constraints.exclude_full_sections and bundle.seat_status == "full":
            return "section_full"
        if any(
            m.start_min < constraints.earliest_start_min or m.end_min > constraints.latest_end_min
            for m in bundle.meetings
        ):
            return "outside_time_window"
        if any(m.day in constraints.blocked_days for m in bundle.meetings):
            return "blocked_day"
        if any(
            _meetings_overlap(a, b)
            for i, a in enumerate(bundle.meetings)
            for b in bundle.meetings[i + 1 :]
        ):
            return "time_overlap"
        return None

    def _walk_between(self, origin: str | None, destination: str | None) -> int | None:
        """Walking minutes between two buildings, or None when that is unknown."""
        if origin is None or destination is None:
            return None
        if origin == destination:
            return 0
        return self._walk_minutes.get((origin, destination))

    def _evaluate_complete(self, total_credits: int, chosen: list[_Choice]) -> None:
        # Credits need no check here: the bounds test in _descend is exact once
        # the last course is placed.
        # Walking is judged on complete combinations only: two meetings that
        # are adjacent in a partial selection may not stay adjacent.
        constraints = self._constraints
        buffer = constraints.walking_buffer_min
        max_walk = constraints.max_walk_per_transition_min

        walking = idle_gap = campus_days = 0
        insufficient_time = exceeds_max = False
        # Transitions whose walking time is unknown: how many, the time between
        # the classes, and the longest walk that time and the limits allow.
        unknown_transitions = unknown_gap = unknown_walk_ceiling = 0
        unknown_pairs: set[tuple[str, str]] = set()
        online_beside_in_person: set[int] = set()  # request indexes of the online courses

        timed = [(meeting, choice) for choice in chosen for meeting in choice.bundle.meetings]
        for day in DAY_ORDER:
            on_day = sorted(
                (item for item in timed if item[0].day == day),
                key=lambda item: (item[0].start_min, item[0].end_min),
            )
            if any(_is_located(meeting) for meeting, _ in on_day):
                campus_days += 1
            for (previous, previous_choice), (following, following_choice) in pairwise(on_day):
                gap = following.start_min - previous.end_min

                if not _is_located(previous) and not _is_located(following):
                    idle_gap += gap  # online to online: nowhere to walk
                    continue
                if not _is_located(previous) or not _is_located(following):
                    # Where the student takes the online class is unknown.
                    online_choice = following_choice if _is_located(previous) else previous_choice
                    online_beside_in_person.add(online_choice.request_index)
                    unknown_transitions += 1
                    unknown_gap += gap
                    unknown_walk_ceiling += gap
                    continue

                walk = self._walk_between(previous.building_id, following.building_id)
                if walk is None:
                    if gap < buffer:
                        insufficient_time = True  # too short even for a walk of 0 minutes
                    else:
                        longest = gap - buffer if max_walk is None else min(gap - buffer, max_walk)
                        unknown_transitions += 1
                        unknown_gap += gap
                        unknown_walk_ceiling += longest
                        if previous.building_id is not None and following.building_id is not None:
                            unknown_pairs.add((previous.building_id, following.building_id))
                    continue

                if gap < walk + buffer:
                    insufficient_time = True
                if max_walk is not None and walk > max_walk:
                    exceeds_max = True
                walking += walk
                idle_gap += gap - walk

        if insufficient_time:
            self._reject("insufficient_walk_time", 1)
            return
        if exceeds_max:
            self._reject("walk_exceeds_max", 1)
            return

        self.explored += 1
        choices = tuple(sorted(chosen, key=lambda c: c.request_index))
        warnings = _warnings(choices, unknown_pairs, online_beside_in_person)
        self.candidates.append(
            _Candidate(
                choices=choices,
                metrics=Metrics(
                    total_credits=total_credits,
                    walking_minutes_weekly=walking,
                    idle_gap_minutes_weekly=idle_gap,
                    campus_days=campus_days,
                ),
                warnings=warnings,
                status=messages.status_for(list(warnings)),
                unknown_travel=(
                    UnknownTravel(gap_minutes=unknown_gap, max_walk_minutes=unknown_walk_ceiling)
                    if unknown_transitions
                    else None
                ),
            )
        )


def _is_located(meeting: Meeting) -> bool:
    """In-person and hybrid meetings happen in a building; online ones do not."""
    return meeting.mode != "online_sync"


def _meetings_overlap(a: Meeting, b: Meeting) -> bool:
    """Half-open [start, end): ending at 10:50 does not overlap starting at 10:50."""
    return a.day == b.day and a.start_min < b.end_min and b.start_min < a.end_min


def _bundles_overlap(a: SectionBundle, b: SectionBundle) -> bool:
    return any(_meetings_overlap(m, n) for m in a.meetings for n in b.meetings)


def _warnings(
    choices: tuple[_Choice, ...],
    unknown_pairs: set[tuple[str, str]],
    online_beside_in_person: set[int],
) -> tuple[str, ...]:
    """Warnings in messages.WARNING_CODES order, then request order."""
    warnings = [
        messages.eligibility_unknown(c.course.course_code)
        for c in choices
        if c.course.eligibility_status == "unknown"
    ]
    warnings += [
        messages.seat_status_unknown(c.course.course_code, c.bundle.bundle_id)
        for c in choices
        if c.bundle.seat_status == "unknown"
    ]
    warnings += [
        messages.section_full_included(c.course.course_code, c.bundle.bundle_id)
        for c in choices
        if c.bundle.seat_status == "full"
    ]
    warnings += [
        messages.building_unknown(c.course.course_code, c.bundle.bundle_id)
        for c in choices
        if any(_is_located(m) and m.building_id is None for m in c.bundle.meetings)
    ]
    warnings += [
        messages.walking_time_unknown(origin, destination)
        for origin, destination in sorted(unknown_pairs)
    ]
    warnings += [
        messages.location_uncertain(c.course.course_code, c.bundle.bundle_id)
        for c in choices
        if c.request_index in online_beside_in_person
    ]
    return tuple(warnings)


def _response(
    request: GenerateRequest, results: list[ScheduleResult], diagnostics: Diagnostics
) -> GenerateResponse:
    return GenerateResponse(
        contract_version=CONTRACT_VERSION,
        request_id=request.request_id,
        term=request.term,
        results=results,
        diagnostics=diagnostics,
    )


def _to_result(rank: int, candidate: _Candidate) -> ScheduleResult:
    return ScheduleResult(
        rank=rank,
        score=candidate.score,
        status=candidate.status,
        selected=[
            SelectedBundle(
                course_id=choice.course.course_id,
                course_code=choice.course.course_code,
                bundle_id=choice.bundle.bundle_id,
                credits=choice.credits,
                meetings=choice.bundle.meetings,
            )
            for choice in candidate.choices
        ],
        metrics=candidate.metrics,
        warnings=list(candidate.warnings),
        reasons=messages.explain(
            candidate.status,
            candidate.unknown_travel is None,
            candidate.metrics.walking_minutes_weekly,
        ),
    )
