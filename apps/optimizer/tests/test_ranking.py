"""Scoring, Top K, tie-breaking and reproducibility."""

import math

import pytest

from app.models import Metrics, Weights
from app.scoring import (
    campus_days_component,
    idle_gap_component,
    ranking_key,
    schedule_score,
    walking_component,
)
from tests.builders import WALKING_ONLY, bundle, bundle_ids, course, load_fixture_request, meeting, request, run

FIXTURE_ORDER = [
    ["cs400-B", "math234-B", "stat240-A"],
    ["cs400-A", "math234-A", "stat240-A"],
    ["cs400-A", "math234-B", "stat240-A"],
]


def _weights(**overrides) -> Weights:
    return Weights(**{**WALKING_ONLY, "walking": 0, **overrides})


def _metrics(walking: int = 0, idle_gap: int = 0, campus_days: int = 1) -> Metrics:
    return Metrics(
        total_credits=10,
        walking_minutes_weekly=walking,
        idle_gap_minutes_weekly=idle_gap,
        campus_days=campus_days,
    )


# --------------------------------------------------------------------------
# Score formulas
# --------------------------------------------------------------------------


@pytest.mark.parametrize("minutes, expected", [(0, 1.0), (12, math.exp(-0.4)), (36, math.exp(-1.2))])
def test_walking_component(minutes, expected):
    assert walking_component(minutes) == pytest.approx(expected)


@pytest.mark.parametrize("minutes, expected", [(0, 1.0), (60, math.exp(-1)), (120, math.exp(-2))])
def test_idle_gap_component(minutes, expected):
    assert idle_gap_component(minutes) == pytest.approx(expected)


@pytest.mark.parametrize(
    "days, expected", [(0, 1.0), (1, 1.0), (2, 0.75), (3, 0.5), (4, 0.25), (5, 0.0), (7, 0.0)]
)
def test_campus_days_component_stays_between_0_and_1(days, expected):
    assert campus_days_component(days) == pytest.approx(expected)


@pytest.mark.parametrize("walking, expected", [(0, 100.0), (12, 67.03), (36, 30.12)])
def test_walking_only_score_matches_fixture_values(walking, expected):
    assert schedule_score(_metrics(walking=walking), _weights(walking=1)) == expected


def test_score_is_a_weighted_average_of_the_active_factors():
    metrics = _metrics(walking=12, idle_gap=8, campus_days=4)
    walking, idle, days = math.exp(-12 / 30), math.exp(-8 / 60), 0.25

    assert schedule_score(metrics, _weights(idle_gap=1)) == round(100 * idle, 2)
    assert schedule_score(metrics, _weights(campus_days=1)) == 25.0
    assert schedule_score(metrics, _weights(walking=1, campus_days=1)) == round(
        100 * (walking + days) / 2, 2
    )
    assert schedule_score(metrics, _weights(walking=1, idle_gap=0.5, campus_days=0.25)) == round(
        100 * (walking + 0.5 * idle + 0.25 * days) / 1.75, 2
    )


def test_scaling_all_weights_together_does_not_change_the_score():
    metrics = _metrics(walking=12, idle_gap=8, campus_days=4)
    assert schedule_score(metrics, _weights(walking=1, idle_gap=0.5)) == schedule_score(
        metrics, _weights(walking=0.5, idle_gap=0.25)
    )


def test_score_has_at_most_two_decimals_and_stays_in_range():
    for walking in range(0, 400, 7):
        score = schedule_score(_metrics(walking=walking), _weights(walking=1))
        assert 0 <= score <= 100
        assert score == round(score, 2)


# --------------------------------------------------------------------------
# Ranking
# --------------------------------------------------------------------------


def test_ranking_key_orders_by_status_then_score_then_ids():
    keys = {
        "ready-high": ranking_key("ready", 90.0, [("c", "c-A", 3)]),
        "ready-low-a": ranking_key("ready", 50.0, [("c", "c-A", 3)]),
        "ready-low-b": ranking_key("ready", 50.0, [("c", "c-B", 3)]),
        "review-top": ranking_key("needs_review", 100.0, [("c", "c-A", 3)]),
    }
    assert sorted(keys, key=keys.get) == ["ready-high", "ready-low-a", "ready-low-b", "review-top"]


def test_ranking_key_ignores_the_order_courses_are_listed_in():
    assert ranking_key("ready", 50.0, [("a", "a-A", 3), ("b", "b-A", 4)]) == ranking_key(
        "ready", 50.0, [("b", "b-A", 4), ("a", "a-A", 3)]
    )


def test_fixture_ranking_follows_walking_minutes():
    results = run(load_fixture_request()).results
    assert [bundle_ids(r) for r in results] == FIXTURE_ORDER
    assert [r.rank for r in results] == [1, 2, 3]
    assert [r.score for r in results] == sorted((r.score for r in results), reverse=True)


def test_idle_gap_weight_reorders_the_fixture():
    payload = load_fixture_request()
    payload["preferences"]["weights"].update(walking=0, idle_gap=1)
    results = run(payload).results
    assert [r.metrics.idle_gap_minutes_weekly for r in results] == [8, 20, 104]
    assert [r.score for r in results] == [
        round(100 * math.exp(-minutes / 60), 2) for minutes in (8, 20, 104)
    ]


@pytest.mark.parametrize("top_k, expected_count", [(1, 1), (2, 2), (3, 3), (5, 3)])
def test_top_k_returns_the_best_k_or_fewer(top_k, expected_count):
    payload = load_fixture_request()
    payload["top_k"] = top_k
    response = run(payload)
    assert [bundle_ids(r) for r in response.results] == FIXTURE_ORDER[:expected_count]
    assert [r.rank for r in response.results] == list(range(1, expected_count + 1))
    assert response.diagnostics.explored_combinations == 4


def test_equal_scores_are_ordered_by_bundle_id():
    payload = request(
        [
            course(
                "x",
                [
                    bundle("x-C", [meeting("WED", 600, 650)]),
                    bundle("x-A", [meeting("MON", 600, 650)]),
                    bundle("x-B", [meeting("TUE", 600, 650)]),
                ],
            )
        ]
    )
    results = run(payload).results
    assert {r.score for r in results} == {100.0}
    assert [bundle_ids(r) for r in results] == [["x-A"], ["x-B"], ["x-C"]]


def test_equal_scores_with_the_same_bundle_are_ordered_by_credits():
    payload = request(
        [course("x", [bundle("x-A", [meeting("MON", 600, 650)])], credits=(3, 1, 2))]
    )
    assert [r.selected[0].credits for r in run(payload).results] == [1, 2, 3]


# --------------------------------------------------------------------------
# Reproducibility
# --------------------------------------------------------------------------


def test_t14_same_request_twice_gives_identical_responses():
    first = run(load_fixture_request()).model_dump_json()
    second = run(load_fixture_request()).model_dump_json()
    assert first == second


def test_ranking_does_not_depend_on_the_order_of_the_input():
    original = run(load_fixture_request())

    shuffled = load_fixture_request()
    shuffled["courses"].reverse()
    for candidate in shuffled["courses"]:
        candidate["section_bundles"].reverse()
    shuffled["walking_edges"].reverse()
    reordered = run(shuffled)

    def summary(response):
        return [(r.rank, r.score, sorted(bundle_ids(r)), r.metrics) for r in response.results]

    assert summary(reordered) == summary(original)
    assert reordered.diagnostics == original.diagnostics


def test_selected_courses_follow_request_order():
    payload = load_fixture_request()
    payload["courses"].reverse()
    for result in run(payload).results:
        assert [s.course_id for s in result.selected] == ["stat240", "math234", "cs400"]
