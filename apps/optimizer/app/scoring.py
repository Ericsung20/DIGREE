"""Soft scoring and ranking (pure functions, no I/O).

The three schedule-shape factors are scored. The data-driven factors (grade
outcomes, degree fit, instructor) need the missing-data rules of Milestone C
and are refused upstream by the engine.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from statistics import median

from app.models import Metrics, Weights

WALKING_SCALE_MIN = 30
IDLE_GAP_SCALE_MIN = 60

# Weekly walking assumed for a schedule with unknown walks when no schedule in
# the response is fully known: the amount that scores exactly half.
FALLBACK_WALKING_MIN = WALKING_SCALE_MIN * math.log(2)

SCHEDULE_SHAPE_FACTORS = ("walking", "idle_gap", "campus_days")
UNIMPLEMENTED_FACTORS = ("grade_outcomes", "degree_fit", "instructor")


@dataclass(frozen=True)
class UnknownTravel:
    """What is known about the transitions whose walking time is not."""

    gap_minutes: int  # total time between the classes on either side of them
    max_walk_minutes: int  # the most walking those gaps and the request's limits allow


def walking_component(walking_minutes_weekly: float) -> float:
    return math.exp(-walking_minutes_weekly / WALKING_SCALE_MIN)


def idle_gap_component(idle_gap_minutes_weekly: float) -> float:
    return math.exp(-idle_gap_minutes_weekly / IDLE_GAP_SCALE_MIN)


def campus_days_component(campus_days: int) -> float:
    # The handoff formula is max(0, 1 - (days - 1) / 4). It exceeds 1 for a
    # schedule with no campus days, so the upper bound keeps scores within 100.
    return min(1.0, max(0.0, 1 - (campus_days - 1) / 4))


def neutral_walking_minutes(complete: Iterable[Metrics]) -> float:
    """Median weekly walking of the schedules whose travel data is complete."""
    known = [metrics.walking_minutes_weekly for metrics in complete]
    return median(known) if known else FALLBACK_WALKING_MIN


def schedule_score(
    metrics: Metrics,
    weights: Weights,
    unknown_travel: UnknownTravel | None = None,
    neutral_walking: float = FALLBACK_WALKING_MIN,
) -> float:
    """Weighted average of the active factors on a 0-100 scale, 2 decimals.

    Pass `unknown_travel` for a schedule with walks of unknown length. Its
    metrics are then subtotals over the known transitions, and scoring them as
    they stand would treat every unknown walk as free. Instead the schedule is
    scored as if its total walking were `neutral_walking`, kept within what is
    possible: no less than the walking already known, and no more than its
    gaps can hold. The assumed walking comes out of the idle time between the
    same classes, so both factors describe one consistent, feasible week.
    """
    walking: float = metrics.walking_minutes_weekly
    idle_gap: float = metrics.idle_gap_minutes_weekly
    if unknown_travel is not None:
        assumed = min(max(neutral_walking - walking, 0), unknown_travel.max_walk_minutes)
        walking += assumed
        idle_gap += unknown_travel.gap_minutes - assumed
    components = {
        "walking": walking_component(walking),
        "idle_gap": idle_gap_component(idle_gap),
        "campus_days": campus_days_component(metrics.campus_days),
    }
    active_weight = sum(getattr(weights, name) for name in SCHEDULE_SHAPE_FACTORS)
    if active_weight <= 0:
        raise ValueError("no implemented scoring factor has a positive weight")
    weighted = sum(getattr(weights, name) * components[name] for name in SCHEDULE_SHAPE_FACTORS)
    return round(100 * weighted / active_weight, 2)


def ranking_key(status: str, score: float, selection: Iterable[tuple[str, str, int]]) -> tuple:
    """Sort key: ready first, then higher score, then a stable ID order.

    `score` is the rounded score clients see, so two schedules that display
    the same score are ordered by their IDs rather than by hidden decimals.
    `selection` holds one (course_id, bundle_id, credits) triple per course.
    """
    return (status != "ready", -score, tuple(sorted(selection)))
