"""Soft scoring and ranking (pure functions, no I/O).

Six weighted factors, each a value between 0 and 1:

- walking, idle_gap, campus_days describe the shape of the week;
- grade_outcomes, degree_fit, instructor come from data the caller supplies.

Nothing here depends on which schedules a search happened to find. Neutral
values and the decision to compare a factor at all come from the request, so
a schedule's score is the same whatever the search limits are.
"""

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from statistics import median

from app.models import GradeStats, Metrics, Weights

WALKING_SCALE_MIN = 30
IDLE_GAP_SCALE_MIN = 60

# Value of a factor that cannot be measured. Used for walking and idle time
# when some walks are unknown; no number of minutes is ever made up.
NEUTRAL_COMPONENT = 0.5

# Score of every schedule when no weighted factor can be compared.
NOT_COMPARABLE_SCORE = 50.0

# Grade smoothing: observed A/AB rates are pulled toward the prior rate, as
# if every course came with this many extra grades at that rate. It is an MVP
# rule from the handoff, not a university statistic.
GRADE_PRIOR_RATE = 0.5
GRADE_PRIOR_STRENGTH = 50

SHAPE_FACTORS = ("walking", "idle_gap", "campus_days")
DATA_FACTORS = ("grade_outcomes", "degree_fit", "instructor")


def walking_component(walking_minutes_weekly: float) -> float:
    return math.exp(-walking_minutes_weekly / WALKING_SCALE_MIN)


def idle_gap_component(idle_gap_minutes_weekly: float) -> float:
    return math.exp(-idle_gap_minutes_weekly / IDLE_GAP_SCALE_MIN)


def campus_days_component(campus_days: int) -> float:
    # The handoff formula is max(0, 1 - (days - 1) / 4). It exceeds 1 for a
    # schedule with no campus days, so the upper bound keeps scores within 100.
    return min(1.0, max(0.0, 1 - (campus_days - 1) / 4))


def smoothed_grade_rate(stats: GradeStats | None) -> float | None:
    """A/AB rate adjusted for sample size, or None when there is nothing to go on."""
    if stats is None or stats.sample_size == 0:
        return None
    n = stats.sample_size
    return (n * stats.a_ab_rate + GRADE_PRIOR_STRENGTH * GRADE_PRIOR_RATE) / (
        n + GRADE_PRIOR_STRENGTH
    )


@dataclass(frozen=True)
class DataFactor:
    """How one data-driven factor is compared within a request."""

    neutral: float | None  # median of the known values; None when nothing is known
    discriminating: bool  # False when every schedule is certain to get the same value

    @property
    def has_data(self) -> bool:
        return self.neutral is not None


def data_factor(known_values: Iterable[float]) -> DataFactor:
    """Baseline for a factor from the known values of everything selectable.

    With fewer than two distinct known values the factor cannot tell schedules
    apart: missing values are filled with the median, which is then that same
    single value.
    """
    known = list(known_values)
    if not known:
        return DataFactor(neutral=None, discriminating=False)
    return DataFactor(neutral=median(known), discriminating=len(set(known)) > 1)


def filled_mean(values: Sequence[float | None], neutral: float) -> float:
    """Mean of the values, with the neutral value standing in for missing ones."""
    return sum(neutral if value is None else value for value in values) / len(values)


def schedule_score(
    metrics: Metrics,
    weights: Weights,
    travel_complete: bool = True,
    data_values: Mapping[str, float] | None = None,
) -> float:
    """Weighted average of the compared factors on a 0-100 scale, 2 decimals.

    `data_values` holds the data-driven factors being compared in this request;
    one left out is simply not part of the average.

    With `travel_complete=False` the metrics are subtotals over the known
    transitions only. Walking and idle time then score the neutral 0.5, or
    less when the known part alone already rules 0.5 out: real totals can only
    be higher than the subtotals, so the subtotal's own score is a ceiling.
    """
    walking = walking_component(metrics.walking_minutes_weekly)
    idle_gap = idle_gap_component(metrics.idle_gap_minutes_weekly)
    if not travel_complete:
        walking = min(walking, NEUTRAL_COMPONENT)
        idle_gap = min(idle_gap, NEUTRAL_COMPONENT)
    values = {
        "walking": walking,
        "idle_gap": idle_gap,
        "campus_days": campus_days_component(metrics.campus_days),
        **(data_values or {}),
    }
    compared = [(getattr(weights, name), value) for name, value in values.items()]
    total_weight = sum(weight for weight, _ in compared)
    if total_weight <= 0:
        return NOT_COMPARABLE_SCORE
    return round(100 * sum(weight * value for weight, value in compared) / total_weight, 2)


def ranking_key(status: str, score: float, selection: Iterable[tuple[str, str, int]]) -> tuple:
    """Sort key: ready first, then higher score, then a stable ID order.

    `score` is the rounded score clients see, so two schedules that display
    the same score are ordered by their IDs rather than by hidden decimals.
    `selection` holds one (course_id, bundle_id, credits) triple per course.
    """
    return (status != "ready", -score, tuple(sorted(selection)))
