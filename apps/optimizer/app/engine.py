"""Pure optimization core: deterministic backtracking with pruning.

No I/O, no clock, no randomness: the same request and limits always yield the
same response.

A schedule holds every required course, plus optional courses when the
required ones cannot reach the credit range on their own. Each selected course
takes exactly one section bundle and one credit option. Hard constraints
reject combinations; unknown data marks a schedule needs_review instead of
being guessed at.
"""

from bisect import insort
from collections import Counter, deque
from collections.abc import Iterator
from dataclasses import dataclass
from itertools import pairwise
from math import prod

from app import CONTRACT_VERSION, messages
from app.config import SearchLimits
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
    Weights,
    walking_minutes_by_pair,
)
from app.scoring import (
    SHAPE_FACTORS,
    DataFactor,
    data_factor,
    filled_mean,
    ranking_key,
    schedule_score,
    smoothed_grade_rate,
    major_balance_component,
)

DAY_ORDER = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


@dataclass(frozen=True)
class _Slot:
    """One course as the search sees it."""

    request_index: int
    course: CandidateCourse
    credit_options: tuple[int, ...]
    bundle_violations: tuple[str | None, ...]  # aligned with course.section_bundles

    @property
    def choices(self) -> int:
        """Ways to settle this course: a bundle and a credit option, or leaving it out."""
        taken = len(self.course.section_bundles) * len(self.credit_options)
        return taken if self.course.is_required else taken + 1


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
    review_warnings: tuple[str, ...]
    advisories: dict[str, str]  # advisory warnings specific to this schedule, by code
    status: str
    travel_complete: bool  # False when the metrics are subtotals over known transitions
    score: float

    def sort_key(self) -> tuple:
        selection = ((c.course.course_id, c.bundle.bundle_id, c.credits) for c in self.choices)
        return ranking_key(self.status, self.score, selection)


@dataclass(frozen=True)
class _ScoringPlan:
    """Which data-driven factors this request compares, decided before the search.

    It depends only on the request, never on which schedules are found, so a
    schedule scores the same whatever the search limits are.
    """

    weights: Weights
    grade: DataFactor | None  # None: not compared
    degree_fit: DataFactor | None
    instructor: DataFactor | None
    breadth: DataFactor | None
    major_balance: bool
    known_easy: bool  # compared: some optional courses are recommended as easy, others not
    preferred_breadths: frozenset[str]
    notices: dict[str, str]  # advisory warnings every result carries, by code


# With distinct course sets, how many schedules per requested result are kept
# while searching, so the final picks can differ from each other.
DIVERSITY_SHORTLIST = 20


class _StepLimitReached(Exception):
    pass


def generate(request: GenerateRequest, limits: SearchLimits = SearchLimits()) -> GenerateResponse:
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

    optional_needed = _optional_courses_needed(request, required)
    usable = _usable_optional_courses(request) if optional_needed else []
    # The caller asks for the whole pool; designations are no longer required for it.
    catalog_search = bool(request.preferences.catalog_search and usable)
    pool = usable if catalog_search else usable[: limits.max_optional_courses]

    plan = _scoring_plan(request.preferences.weights, required, [course for _, course in usable], request.preferences.preferred_breadths)
    search = _Search(
        request, pool, plan,
        limits.max_catalog_search_steps if catalog_search else limits.max_search_steps,
        catalog_search=catalog_search,
        distinct_course_sets=limits.distinct_course_sets,
    )
    search.run()

    # Either limit leaves combinations unexamined, so nothing below may be
    # presented as the best possible or as proof that no schedule exists.
    truncated = search.stopped_early or len(pool) < len(usable)
    notices = dict(plan.notices)
    if truncated:
        notices["search_incomplete"] = messages.search_incomplete()

    results = [
        _to_result(rank, candidate, notices) for rank, candidate in enumerate(search.results(), start=1)
    ]

    occurred = [reason for reason in REJECTION_REASONS if search.rejected[reason] > 0]
    no_results_reasons: list[str] = []
    if not results:
        if truncated:
            no_results_reasons.append(messages.SEARCH_TRUNCATED)
        no_results_reasons += without_bundles
        if optional_needed and not usable:
            no_results_reasons.append(messages.NO_USABLE_OPTIONAL_COURSES)
        no_results_reasons += occurred

    return _response(
        request,
        results,
        Diagnostics(
            explored_combinations=search.explored,
            rejected_by_reason={reason: search.rejected[reason] for reason in occurred},
            search_truncated=truncated,
            no_results_reasons=no_results_reasons,
        ),
    )


def _blocking_reasons(required: list[CandidateCourse]) -> list[str]:
    """H8: reasons a required course cannot be taken at all."""
    reasons = []
    if any(course.eligibility_status == "ineligible" for course in required):
        reasons.append(messages.REQUIRED_COURSE_INELIGIBLE)
    if any(course.already_completed and not course.repeatable for course in required):
        reasons.append(messages.REQUIRED_COURSE_ALREADY_COMPLETED)
    return reasons


def _optional_courses_needed(request: GenerateRequest, required: list[CandidateCourse]) -> bool:
    """Optional courses join only when the required ones cannot reach the range alone."""
    if len(required) == len(request.courses):
        return False
    if not required:
        return True
    required_totals = {0}
    for course in required:
        required_totals = {
            total + credits for total in required_totals for credits in course.credit_options
        }
    constraints = request.constraints
    if any(constraints.min_credits <= total <= constraints.max_credits for total in required_totals):
        return False
    # Optional courses can only add credits, so they help only when some
    # required-course total still has room below the maximum.
    return min(required_totals) < constraints.max_credits


def _usable_optional_courses(request: GenerateRequest) -> list[tuple[int, CandidateCourse]]:
    """H8 for optional courses, as (request index, course), breadth then degree fit.

    Ties go to the lower course_id, so neither the shortlist nor the search
    order depends on how the request happens to list the courses.
    """
    usable = [
        (index, course)
        for index, course in enumerate(request.courses)
        if not course.is_required
        and course.eligibility_status != "ineligible"
        and not (course.already_completed and not course.repeatable)
        and course.section_bundles
    ]
    preferred = {code.strip().casefold() for code in request.preferences.preferred_breadths}
    favor_breadth = bool(preferred and request.preferences.weights.breadth > 0)
    return sorted(
        usable,
        key=lambda item: (
            not bool(preferred.intersection(code.strip().casefold() for code in item[1].breadth or [])) if favor_breadth else False,
            item[1].requirement_fit is None,
            -(item[1].requirement_fit or 0),
            item[1].course_id,
        ),
    )


def _scoring_plan(
    weights: Weights, required: list[CandidateCourse], optional: list[CandidateCourse], preferred_breadths: list[str]
) -> _ScoringPlan:
    """Decide from the request alone which data-driven factors can be compared.

    A factor is left out when the request holds no data for it, or when every
    schedule is certain to get the same value. Grade outcomes and degree fit
    are about the optional courses, so they are not compared when none are in
    play.
    """
    notices: dict[str, str] = {}
    grade = degree_fit = instructor = breadth = None
    preferred = frozenset(code.strip().casefold() for code in preferred_breadths)

    if optional and weights.grade_outcomes > 0:
        factor = data_factor(
            rate for c in optional if (rate := smoothed_grade_rate(c.grade_stats)) is not None
        )
        if not factor.has_data:
            notices["grade_data_missing"] = messages.grade_data_unavailable()
        elif factor.discriminating:
            grade = factor

    if optional and weights.degree_fit > 0:
        factor = data_factor(c.requirement_fit for c in optional if c.requirement_fit is not None)
        if not factor.has_data:
            notices["degree_fit_data_missing"] = messages.degree_fit_data_unavailable()
        elif factor.discriminating:
            degree_fit = factor

    if optional and preferred and weights.breadth > 0:
        factor = data_factor(
            float(bool(preferred.intersection(code.strip().casefold() for code in c.breadth)))
            for c in optional if c.breadth is not None
        )
        if not factor.has_data:
            notices["breadth_data_missing"] = messages.breadth_data_unavailable()
        elif factor.discriminating:
            breadth = factor

    if weights.instructor > 0:
        factor = data_factor(
            bundle.instructor_score
            for course in required + optional
            for bundle in course.section_bundles
            if bundle.instructor_score is not None
        )
        if not factor.has_data:
            notices["instructor_data_missing"] = messages.instructor_data_unavailable()
        elif optional:
            # The set of courses varies, so any two different ratings can matter.
            if factor.discriminating:
                instructor = factor
        elif any(
            len(
                {
                    factor.neutral if b.instructor_score is None else b.instructor_score
                    for b in course.section_bundles
                }
            )
            > 1
            for course in required
        ):
            # The courses are fixed, so only a choice between sections of one
            # course with different ratings can matter.
            instructor = factor

    compared = [name for name in SHAPE_FACTORS if getattr(weights, name) > 0]
    major_balance = weights.major_balance > 0 and any(course.is_major_course for course in optional)
    known_easy = weights.known_easy > 0 and len({course.known_easy for course in optional}) > 1
    if not compared and grade is None and degree_fit is None and instructor is None and breadth is None and not major_balance and not known_easy:
        notices["score_not_comparable"] = messages.score_not_comparable()

    return _ScoringPlan(weights, grade, degree_fit, instructor, breadth, major_balance, known_easy, preferred, notices)


class _Search:
    def __init__(
        self,
        request: GenerateRequest,
        pool: list[tuple[int, CandidateCourse]],
        plan: _ScoringPlan,
        max_steps: int,
        *,
        catalog_search: bool,
        distinct_course_sets: bool = False,
    ):
        self._constraints = request.constraints
        self._walk_minutes = walking_minutes_by_pair(request.walking_edges)
        self._plan = plan
        self._max_steps = max_steps
        self._top_k = request.top_k
        self._catalog_search = catalog_search
        self._distinct_course_sets = distinct_course_sets
        self._prefer_max_credits = request.preferences.prefer_max_credits

        required = [
            self._slot(index, course)
            for index, course in enumerate(request.courses)
            if course.is_required
        ]
        # Required courses first, fewest bundles first, ties in request order.
        # Then the optional pool in its own order (preferred breadth, then degree fit).
        required.sort(key=lambda s: (len(s.course.section_bundles), s.request_index))
        self._slots = required + [self._slot(index, course) for index, course in pool]
        self._required_count = len(required)

        # Per depth: how many complete combinations, and how many credits,
        # the courses from that depth onward can still contribute. An optional
        # course may be left out, so it contributes no minimum.
        count = len(self._slots)
        self._completions_from = [] if catalog_search else [
            prod(s.choices for s in self._slots[d:]) for d in range(count + 1)
        ]
        self._min_credits_from = [0] * (count + 1)
        self._max_credits_from = [0] * (count + 1)
        for i in range(count - 1, -1, -1):
            slot = self._slots[i]
            self._min_credits_from[i] = self._min_credits_from[i + 1] + (slot.credit_options[0] if slot.course.is_required else 0)
            self._max_credits_from[i] = self._max_credits_from[i + 1] + slot.credit_options[-1]

        self.steps = 0
        self.stopped_early = False
        self.explored = 0
        self.rejected: Counter[str] = Counter()
        self.candidates: list[_Candidate] = []
        self._kept_sets: dict[frozenset[str], _Candidate] = {}  # with distinct course sets

    def _slot(self, request_index: int, course: CandidateCourse) -> _Slot:
        return _Slot(
            request_index=request_index,
            course=course,
            credit_options=tuple(sorted(set(course.credit_options))),
            bundle_violations=tuple(self._bundle_violation(b) for b in course.section_bundles),
        )

    def run(self) -> None:
        try:
            if self._catalog_search:
                self._run_catalog()
            else:
                self._descend(0, 0, [])
        except _StepLimitReached:
            self.stopped_early = True

    def _run_catalog(self) -> None:
        # Interleave required section combinations as well as the first optional
        # course. This lets late catalog entries start competing early.
        required = self._required_selections(0, 0, [])
        active: deque[Iterator[None]] = deque()
        while active or required is not None:
            if required is not None and len(active) < 16:
                selection = next(required, None)
                if selection is None:
                    required = None
                else:
                    credits, chosen = selection
                    active.append(self._catalog_rounds(credits, chosen))
            if active:
                branch = active.popleft()
                if self._advance(branch, 256):
                    active.append(branch)

    @staticmethod
    def _advance(branch: Iterator[None], steps: int) -> bool:
        for _ in range(steps):
            try:
                next(branch)
            except StopIteration:
                return False
        return True

    def _required_selections(
        self, depth: int, credits: int, chosen: list[_Choice]
    ) -> Iterator[tuple[int, tuple[_Choice, ...]]]:
        if depth == self._required_count:
            yield credits, tuple(chosen)
            return
        for choice in self._catalog_placements(depth, credits, chosen):
            if choice is not None:
                chosen.append(choice)
                yield from self._required_selections(depth + 1, credits + choice.credits, chosen)
                chosen.pop()

    def _catalog_rounds(self, credits: int, chosen: tuple[_Choice, ...]) -> Iterator[None]:
        branches = deque(
            self._catalog_branch(i, credits, list(chosen))
            for i in range(self._required_count, len(self._slots))
        )
        while branches:
            branch = branches.popleft()
            for _ in range(8):
                try:
                    next(branch)
                except StopIteration:
                    break
                yield
            else:
                branches.append(branch)

    def _catalog_branch(self, index: int, credits: int, chosen: list[_Choice]) -> Iterator[None]:
        for choice in self._catalog_placements(index, credits, chosen):
            yield
            if choice is None:
                continue
            total = credits + choice.credits
            chosen.append(choice)
            if total >= self._constraints.min_credits:
                self._step()
                self._evaluate_complete(total, chosen)
                yield
            # Enumerate only selected courses and only in increasing slot order.
            # Depth depends on credits, so large catalogs do not grow the call stack.
            if total < self._constraints.max_credits:
                for next_index in range(index + 1, len(self._slots)):
                    if total + self._max_credits_from[next_index] < self._constraints.min_credits:
                        break
                    yield from self._catalog_branch(next_index, total, chosen)
            chosen.pop()

    def _catalog_placements(
        self, index: int, credits: int, chosen: list[_Choice]
    ) -> Iterator[_Choice | None]:
        slot = self._slots[index]
        constraints = self._constraints
        if self._at_major_course_limit(slot.course, chosen):
            self._step()
            self._reject("max_major_courses_exceeded", slot.choices if slot.course.is_required else slot.choices - 1)
            yield None
            return
        for added in slot.credit_options:
            total = credits + added
            if (total + self._min_credits_from[index + 1] > constraints.max_credits
                or total + self._max_credits_from[index + 1] < constraints.min_credits):
                self._step()
                self._reject("credits_out_of_range", 1)
                yield None
                continue
            for bundle, violation in zip(slot.course.section_bundles, slot.bundle_violations):
                self._step()
                if violation is None and any(_bundles_overlap(bundle, item.bundle) for item in chosen):
                    violation = "time_overlap"
                if violation is not None:
                    self._reject(violation, 1)
                    yield None
                else:
                    yield _Choice(slot.request_index, slot.course, bundle, added)

    def _step(self) -> None:
        """One unit of search work. Counting steps, not seconds, keeps a capped
        search reproducible on any machine."""
        if self.steps >= self._max_steps:
            raise _StepLimitReached
        self.steps += 1

    def _descend(self, depth: int, credits_so_far: int, chosen: list[_Choice]) -> None:
        if depth == len(self._slots):
            self._step()
            if chosen:  # selecting nothing is not a schedule, and is never counted
                self._evaluate_complete(credits_so_far, chosen)
            return

        constraints = self._constraints
        slot = self._slots[depth]
        bundles = slot.course.section_bundles
        completions_below = self._completions_from[depth + 1]

        for credits in slot.credit_options:
            total = credits_so_far + credits
            if self._at_major_course_limit(slot.course, chosen):
                self._step()
                self._reject("max_major_courses_exceeded", len(bundles) * completions_below)
                continue
            if (
                total + self._min_credits_from[depth + 1] > constraints.max_credits
                or total + self._max_credits_from[depth + 1] < constraints.min_credits
            ):
                self._step()
                self._reject("credits_out_of_range", len(bundles) * completions_below)
                continue
            for bundle, violation in zip(bundles, slot.bundle_violations):
                self._step()
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

        if not slot.course.is_required:
            # Leave this optional course out.
            self._step()
            if credits_so_far + self._max_credits_from[depth + 1] < constraints.min_credits:
                # Nothing below can reach the minimum. With no course chosen
                # yet, one of those combinations is the empty selection.
                self._reject("credits_out_of_range", completions_below - (0 if chosen else 1))
            else:
                self._descend(depth + 1, credits_so_far, chosen)

    def _reject(self, reason: str, combinations: int) -> None:
        """Count every complete combination beneath a pruned selection."""
        self.explored += combinations
        self.rejected[reason] += combinations

    def _at_major_course_limit(self, course: CandidateCourse, chosen: list[_Choice]) -> bool:
        limit = self._constraints.max_major_courses
        return limit is not None and course.is_major_course and sum(choice.course.is_major_course for choice in chosen) >= limit

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
        # Credits need no check here: the bounds tests in _descend are exact
        # once the last course is settled.
        # Walking is judged on complete combinations only: two meetings that
        # are adjacent in a partial selection may not stay adjacent.
        constraints = self._constraints
        buffer = constraints.walking_buffer_min
        max_walk = constraints.max_walk_per_transition_min

        walking = idle_gap = campus_days = 0
        insufficient_time = exceeds_max = False
        travel_complete = True
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
                    travel_complete = False
                    continue

                walk = self._walk_between(previous.building_id, following.building_id)
                if walk is None:
                    if gap < buffer:
                        insufficient_time = True  # too short even for a walk of 0 minutes
                    else:
                        travel_complete = False
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
        metrics = Metrics(
            total_credits=total_credits,
            walking_minutes_weekly=walking,
            idle_gap_minutes_weekly=idle_gap,
            campus_days=campus_days,
        )
        review_warnings = _review_warnings(choices, unknown_pairs, online_beside_in_person)
        data_values, advisories = self._data_factors(choices)
        candidate = _Candidate(
            choices=choices,
            metrics=metrics,
            review_warnings=review_warnings,
            advisories=advisories,
            status=messages.status_for(list(review_warnings)),
            travel_complete=travel_complete,
            score=schedule_score(metrics, self._plan.weights, travel_complete, data_values),
        )
        self._offer(candidate)

    def _offer(self, candidate: _Candidate) -> None:
        """Keep the top k schedules; with distinct course sets, at most one per set of courses.

        Two schedules with the same courses differ only in their sections, so
        only the better ranked one is kept; the caller can show the other
        sections of each course on its own. With distinct course sets a wider
        shortlist is kept, so `results` can pick sets that differ from each other.
        """
        key = self._rank_key(candidate)
        courses = _course_set(candidate) if self._distinct_course_sets else None
        if courses is not None:
            kept = self._kept_sets.get(courses)
            if kept is not None:
                if key < self._rank_key(kept):
                    self.candidates.remove(kept)
                    insort(self.candidates, candidate, key=self._rank_key)
                    self._kept_sets[courses] = candidate
                return
        keep = self._top_k * DIVERSITY_SHORTLIST if self._distinct_course_sets else self._top_k
        if len(self.candidates) < keep or key < self._rank_key(self.candidates[-1]):
            insort(self.candidates, candidate, key=self._rank_key)
            if courses is not None:
                self._kept_sets[courses] = candidate
            if len(self.candidates) > keep:
                dropped = self.candidates.pop()
                if courses is not None:
                    del self._kept_sets[_course_set(dropped)]

    def results(self) -> list[_Candidate]:
        """The schedules to return, best first.

        Without distinct course sets, the top k. With them, the best schedule
        first, then each next one is the best ranked that shares fewer than half
        of its added courses with every schedule already picked; when none does,
        the one sharing the fewest. The picks are returned in rank order.
        """
        if not self._distinct_course_sets:
            return self.candidates[: self._top_k]
        remaining = list(self.candidates)
        picked: list[_Candidate] = []
        while remaining and len(picked) < self._top_k:
            best = min(
                range(len(remaining)),
                key=lambda i: (_diversity_tier(remaining[i], picked), i),
            )
            picked.append(remaining.pop(best))
        return sorted(picked, key=self._rank_key)

    def _rank_key(self, candidate: _Candidate) -> tuple:
        review, score, selection = candidate.sort_key()
        key = (score, review, selection) if self._catalog_search else (review, score, selection)
        if self._prefer_max_credits:
            # Closer to the credit target first; the score decides between equal totals.
            return (self._constraints.max_credits - candidate.metrics.total_credits, *key)
        return key

    def _data_factors(self, choices: tuple[_Choice, ...]) -> tuple[dict[str, float], dict[str, str]]:
        """Values of the compared data-driven factors, and notes on what was missing.

        A missing value takes the request's neutral value, so a course or
        section without data is neither rewarded nor penalised for it.
        """
        plan = self._plan
        optional = [c for c in choices if not c.course.is_required]
        values: dict[str, float] = {}
        advisories: dict[str, str] = {}

        if plan.grade is not None:
            rates = [smoothed_grade_rate(c.course.grade_stats) for c in optional]
            values["grade_outcomes"] = filled_mean(rates, plan.grade.neutral)
            missing = [c.course.course_code for c, rate in zip(optional, rates) if rate is None]
            if missing:
                advisories["grade_data_missing"] = messages.grade_data_missing(missing)

        if plan.degree_fit is not None:
            fits = [c.course.requirement_fit for c in optional]
            values["degree_fit"] = filled_mean(fits, plan.degree_fit.neutral)
            missing = [c.course.course_code for c, fit in zip(optional, fits) if fit is None]
            if missing:
                advisories["degree_fit_data_missing"] = messages.degree_fit_data_missing(missing)

        if plan.breadth is not None:
            matches = [None if c.course.breadth is None else float(bool(plan.preferred_breadths.intersection(code.strip().casefold() for code in c.course.breadth))) for c in optional]
            values["breadth"] = filled_mean(matches, plan.breadth.neutral)
            missing = [c.course.course_code for c, match in zip(optional, matches) if match is None]
            if missing:
                advisories["breadth_data_missing"] = messages.breadth_data_missing(missing)

        if plan.known_easy:
            # Mean over the added courses; a schedule that adds none gets 0.
            values["known_easy"] = sum(c.course.known_easy for c in optional) / len(optional) if optional else 0.0

        if plan.major_balance:
            values["major_balance"] = major_balance_component(sum(choice.course.is_major_course for choice in choices))

        if plan.instructor is not None:
            ratings = [c.bundle.instructor_score for c in choices]
            values["instructor"] = filled_mean(ratings, plan.instructor.neutral)
            missing = [
                f"{c.course.course_code} ({c.bundle.bundle_id})"
                for c, rating in zip(choices, ratings)
                if rating is None
            ]
            if missing:
                advisories["instructor_data_missing"] = messages.instructor_data_missing(missing)

        return values, advisories


def _course_set(candidate: _Candidate) -> frozenset[str]:
    return frozenset(choice.course.course_id for choice in candidate.choices)


def _added_courses(candidate: _Candidate) -> frozenset[str]:
    return frozenset(c.course.course_id for c in candidate.choices if not c.course.is_required)


def _diversity_tier(candidate: _Candidate, picked: list[_Candidate]) -> tuple[int, int]:
    """(0, 0) when the candidate shares fewer than half of its added courses with
    every pick; otherwise (1, most courses shared with any pick). Lower is more distinct."""
    added = _added_courses(candidate)
    shared = [len(added & _added_courses(other)) for other in picked]
    worst = max(shared, default=0)
    return (0, 0) if 2 * worst < len(added) else (1, worst)


def _is_located(meeting: Meeting) -> bool:
    """In-person and hybrid meetings happen in a building; online ones do not."""
    return meeting.mode != "online_sync"


def _meetings_overlap(a: Meeting, b: Meeting) -> bool:
    """Half-open [start, end): ending at 10:50 does not overlap starting at 10:50."""
    return a.day == b.day and a.start_min < b.end_min and b.start_min < a.end_min


def _bundles_overlap(a: SectionBundle, b: SectionBundle) -> bool:
    return any(_meetings_overlap(m, n) for m in a.meetings for n in b.meetings)


def _review_warnings(
    choices: tuple[_Choice, ...],
    unknown_pairs: set[tuple[str, str]],
    online_beside_in_person: set[int],
) -> tuple[str, ...]:
    """Warnings in messages.REVIEW_WARNING_CODES order, then request order."""
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


def _to_result(rank: int, candidate: _Candidate, notices: dict[str, str]) -> ScheduleResult:
    advisories = messages.in_listed_order({**notices, **candidate.advisories})
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
        warnings=[*candidate.review_warnings, *advisories],
        reasons=messages.explain(
            candidate.status,
            candidate.travel_complete,
            candidate.metrics.walking_minutes_weekly,
            [c.course.course_code for c in candidate.choices if not c.course.is_required],
        ),
    )
