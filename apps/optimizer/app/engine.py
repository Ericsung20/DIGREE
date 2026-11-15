"""Pure optimization core: deterministic backtracking with pruning.

No I/O, no clock, no randomness: the same request always yields the same
response. Milestone A covers required-course schedules built from known data.
Anything beyond that raises UnsupportedFeatureError instead of returning a
response that ignores part of the request.
"""

from collections import Counter
from dataclasses import dataclass
from itertools import pairwise
from math import prod

from app import CONTRACT_VERSION
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
from app.scoring import UNIMPLEMENTED_FACTORS, ranking_key, schedule_score

DAY_ORDER = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")

# Keys of diagnostics.rejected_by_reason, in the order the checks run.
# Each rejected combination is counted once, under the first check it fails.
REJECTION_REASONS = (
    "credits_out_of_range",
    "outside_time_window",
    "blocked_day",
    "time_overlap",
    "insufficient_walk_time",
    "walk_exceeds_max",
)

REQUIRED_COURSE_WITHOUT_BUNDLES = "required_course_without_bundles"


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
    score: float
    status: str = "ready"

    def sort_key(self) -> tuple:
        selection = ((c.course.course_id, c.bundle.bundle_id, c.credits) for c in self.choices)
        return ranking_key(self.status, self.score, selection)


def generate(request: GenerateRequest) -> GenerateResponse:
    unsupported = find_unsupported_features(request)
    if unsupported:
        raise UnsupportedFeatureError(unsupported)

    search = _Search(request)
    search.run()

    ranked = sorted(search.candidates, key=_Candidate.sort_key)[: request.top_k]
    results = [_to_result(rank, candidate) for rank, candidate in enumerate(ranked, start=1)]

    return GenerateResponse(
        contract_version=CONTRACT_VERSION,
        request_id=request.request_id,
        term=request.term,
        results=results,
        diagnostics=Diagnostics(
            explored_combinations=search.explored,
            rejected_by_reason={
                reason: search.rejected[reason]
                for reason in REJECTION_REASONS
                if search.rejected[reason] > 0
            },
            search_truncated=False,
            no_results_reasons=[] if results else search.no_results_reasons(),
        ),
    )


def find_unsupported_features(request: GenerateRequest) -> list[str]:
    """List what the request needs beyond Milestone A, as '<path>: <message>'.

    Only required courses are inspected: optional courses are never selected
    in Milestone A, so their data cannot change the response.
    """
    details: list[str] = []
    constraints = request.constraints

    for factor in UNIMPLEMENTED_FACTORS:
        if getattr(request.preferences.weights, factor) > 0:
            details.append(
                f"preferences.weights.{factor}: scoring by {factor} is not implemented yet"
            )

    for index, course in enumerate(request.courses):
        if not course.is_required:
            continue
        path = f"courses[{index}]"
        if course.eligibility_status != "eligible":
            details.append(
                f"{path}.eligibility_status: required course {course.course_id} is "
                f"'{course.eligibility_status}'; eligibility handling is not implemented yet"
            )
        if course.already_completed and not course.repeatable:
            details.append(
                f"{path}.already_completed: required course {course.course_id} is completed and "
                "not repeatable; completed-course handling is not implemented yet"
            )
        for bundle_index, bundle in enumerate(course.section_bundles):
            bundle_path = f"{path}.section_bundles[{bundle_index}]"
            if bundle.seat_status == "unknown":
                details.append(
                    f"{bundle_path}.seat_status: bundle {bundle.bundle_id} has unknown seat "
                    "status; review-required results are not implemented yet"
                )
            elif bundle.seat_status == "full" and constraints.exclude_full_sections:
                details.append(
                    f"{bundle_path}.seat_status: bundle {bundle.bundle_id} is full and "
                    "exclude_full_sections is true; full-section exclusion is not implemented yet"
                )
            for meeting_index, meeting in enumerate(bundle.meetings):
                meeting_path = f"{bundle_path}.meetings[{meeting_index}]"
                if meeting.mode != "in_person":
                    details.append(
                        f"{meeting_path}.mode: '{meeting.mode}' meetings are not implemented yet"
                    )
                elif meeting.building_id is None:
                    details.append(
                        f"{meeting_path}.building_id: in-person meetings without a building "
                        "are not implemented yet"
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


class _Search:
    def __init__(self, request: GenerateRequest):
        self._constraints = request.constraints
        self._weights = request.preferences.weights
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

    def no_results_reasons(self) -> list[str]:
        reasons = []
        if any(not slot.course.section_bundles for slot in self._slots):
            reasons.append(REQUIRED_COURSE_WITHOUT_BUNDLES)
        reasons.extend(reason for reason in REJECTION_REASONS if self.rejected[reason] > 0)
        return reasons

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

    def _evaluate_complete(self, total_credits: int, chosen: list[_Choice]) -> None:
        # Credits need no check here: the bounds test in _descend is exact once
        # the last course is placed.
        # Walking is judged on complete combinations only: two meetings that
        # are adjacent in a partial selection may not stay adjacent.
        constraints = self._constraints
        meetings = [m for choice in chosen for m in choice.bundle.meetings]
        walking = idle_gap = campus_days = 0
        insufficient_time = exceeds_max = False
        unknown_pairs: set[tuple[str, str]] = set()

        for day in DAY_ORDER:
            on_day = sorted(
                (m for m in meetings if m.day == day), key=lambda m: (m.start_min, m.end_min)
            )
            if on_day:
                campus_days += 1
            for previous, following in pairwise(on_day):
                gap = following.start_min - previous.end_min
                if previous.building_id == following.building_id:
                    walk = 0
                else:
                    pair = (previous.building_id, following.building_id)
                    if pair not in self._walk_minutes:
                        unknown_pairs.add(pair)
                        continue
                    walk = self._walk_minutes[pair]
                if gap < walk + constraints.walking_buffer_min:
                    insufficient_time = True
                if (
                    constraints.max_walk_per_transition_min is not None
                    and walk > constraints.max_walk_per_transition_min
                ):
                    exceeds_max = True
                walking += walk
                idle_gap += gap - walk

        if insufficient_time:
            self._reject("insufficient_walk_time", 1)
            return
        if exceeds_max:
            self._reject("walk_exceeds_max", 1)
            return
        if unknown_pairs:
            # The schedule survives every known check but depends on a walking
            # time nobody supplied. It must not be scored as if that were 0.
            raise UnsupportedFeatureError(
                [
                    f"walking_edges: no walking time from {origin} to {destination}; "
                    "review-required results are not implemented yet"
                    for origin, destination in sorted(unknown_pairs)
                ]
            )

        self.explored += 1
        metrics = Metrics(
            total_credits=total_credits,
            walking_minutes_weekly=walking,
            idle_gap_minutes_weekly=idle_gap,
            campus_days=campus_days,
        )
        self.candidates.append(
            _Candidate(
                choices=tuple(sorted(chosen, key=lambda c: c.request_index)),
                metrics=metrics,
                score=schedule_score(metrics, self._weights),
            )
        )


def _meetings_overlap(a: Meeting, b: Meeting) -> bool:
    """Half-open [start, end): ending at 10:50 does not overlap starting at 10:50."""
    return a.day == b.day and a.start_min < b.end_min and b.start_min < a.end_min


def _bundles_overlap(a: SectionBundle, b: SectionBundle) -> bool:
    return any(_meetings_overlap(m, n) for m in a.meetings for n in b.meetings)


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
        warnings=[],
        reasons=[
            "All selected courses fit; weekly between-class walking: "
            f"{candidate.metrics.walking_minutes_weekly} min."
        ],
    )
