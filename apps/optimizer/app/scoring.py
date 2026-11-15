"""Soft scoring and ranking (pure functions, no I/O).

Milestone A scores the three schedule-shape factors only. The data-driven
factors (grade outcomes, degree fit, instructor) need the missing-data rules
of Milestone C and are refused upstream by the engine.
"""

import math
from collections.abc import Iterable

from app.models import Metrics, Weights

WALKING_SCALE_MIN = 30
IDLE_GAP_SCALE_MIN = 60

SCHEDULE_SHAPE_FACTORS = ("walking", "idle_gap", "campus_days")
UNIMPLEMENTED_FACTORS = ("grade_outcomes", "degree_fit", "instructor")


def walking_component(walking_minutes_weekly: int) -> float:
    return math.exp(-walking_minutes_weekly / WALKING_SCALE_MIN)


def idle_gap_component(idle_gap_minutes_weekly: int) -> float:
    return math.exp(-idle_gap_minutes_weekly / IDLE_GAP_SCALE_MIN)


def campus_days_component(campus_days: int) -> float:
    # The handoff formula is max(0, 1 - (days - 1) / 4). It exceeds 1 for a
    # schedule with no campus days, so the upper bound keeps scores within 100.
    return min(1.0, max(0.0, 1 - (campus_days - 1) / 4))


def schedule_score(metrics: Metrics, weights: Weights) -> float:
    """Weighted average of the active factors on a 0-100 scale, 2 decimals."""
    components = {
        "walking": walking_component(metrics.walking_minutes_weekly),
        "idle_gap": idle_gap_component(metrics.idle_gap_minutes_weekly),
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
