"""Scoring, Top K, tie-breaking and reproducibility."""

import math

import pytest

from app.models import Metrics, Weights
from app.scoring import (
    FALLBACK_WALKING_MIN,
    UnknownTravel,
    campus_days_component,
    idle_gap_component,
    neutral_walking_minutes,
    ranking_key,
    schedule_score,
    walking_component,
)
from tests.builders import (
    WALKING_ONLY,
    bundle,
    bundle_ids,
    course,
    edge,
    load_fixture_request,
    meeting,
    request,
    run,
)

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


# --------------------------------------------------------------------------
# Scoring schedules with walks of unknown length
# --------------------------------------------------------------------------

NOTHING_KNOWN = dict(walking=0, idle_gap=0)
ROOMY = UnknownTravel(gap_minutes=120, max_walk_minutes=120)


def test_neutral_walking_is_the_median_of_fully_known_schedules():
    assert neutral_walking_minutes([_metrics(walking=w) for w in (36, 0, 12)]) == 12
    assert neutral_walking_minutes([_metrics(walking=0), _metrics(walking=36)]) == 18
    assert neutral_walking_minutes([_metrics(walking=w) for w in (5, 40, 0, 18)]) == (
        neutral_walking_minutes([_metrics(walking=w) for w in (18, 0, 40, 5)])
    )


def test_neutral_walking_falls_back_to_the_walk_that_scores_half():
    assert neutral_walking_minutes([]) == FALLBACK_WALKING_MIN
    assert walking_component(FALLBACK_WALKING_MIN) == pytest.approx(0.5)
    assert schedule_score(_metrics(**NOTHING_KNOWN), _weights(walking=1), ROOMY) == 50.0


def test_unknown_walk_is_scored_at_the_neutral_value_not_as_zero_minutes():
    metrics = _metrics(**NOTHING_KNOWN)
    assert schedule_score(metrics, _weights(walking=1)) == 100.0
    assert schedule_score(metrics, _weights(walking=1), ROOMY, neutral_walking=18) == round(
        100 * math.exp(-18 / 30), 2
    )


def test_assumed_walk_comes_out_of_the_idle_time_between_the_same_classes():
    metrics = _metrics(**NOTHING_KNOWN)
    assert schedule_score(metrics, _weights(idle_gap=1), ROOMY, neutral_walking=18) == round(
        100 * math.exp(-(120 - 18) / 60), 2
    )


def test_assumed_walk_is_limited_to_what_the_gaps_allow():
    tight = UnknownTravel(gap_minutes=10, max_walk_minutes=7)
    metrics = _metrics(**NOTHING_KNOWN)
    assert schedule_score(metrics, _weights(walking=1), tight, neutral_walking=18) == round(
        100 * math.exp(-7 / 30), 2
    )
    assert schedule_score(metrics, _weights(idle_gap=1), tight, neutral_walking=18) == round(
        100 * math.exp(-3 / 60), 2
    )


def test_known_walking_above_the_neutral_value_is_never_reduced():
    metrics = _metrics(walking=90, idle_gap=30)
    assert schedule_score(metrics, _weights(walking=1), ROOMY, neutral_walking=18) == round(
        100 * math.exp(-90 / 30), 2
    )
    assert schedule_score(metrics, _weights(idle_gap=1), ROOMY, neutral_walking=18) == round(
        100 * math.exp(-(30 + 120) / 60), 2
    )


def test_campus_days_are_scored_the_same_with_unknown_walks():
    assert schedule_score(_metrics(campus_days=3), _weights(campus_days=1), ROOMY, 18) == 50.0


AA = ("cs400-A", "math234-A", "stat240-A")
AB = ("cs400-A", "math234-B", "stat240-A")
BB = ("cs400-B", "math234-B", "stat240-A")

ALPHA_BETA, ALPHA_GAMMA = 0, 1  # positions in the fixture's walking_edges

WEIGHT_MIXES = [
    {"walking": 1},
    {"walking": 0, "idle_gap": 1},
    {"walking": 1, "idle_gap": 1},
    {"walking": 0.5, "idle_gap": 1, "campus_days": 0.25},
]


def _fixture(weights: dict, edge_index: int, minutes: int | None) -> dict:
    """The fixture with one edge set to `minutes`, or removed when that is None."""
    payload = load_fixture_request()
    payload["preferences"]["weights"].update(weights)
    if minutes is None:
        payload["walking_edges"].pop(edge_index)
    else:
        payload["walking_edges"][edge_index]["minutes"] = minutes
    return payload


def _by_bundles(response) -> dict:
    return {tuple(bundle_ids(r)): r for r in response.results}


def test_missing_walking_time_does_not_earn_a_perfect_walking_score():
    """Without ALPHA-BETA, cs400-A + math234-A has no known walking at all.

    The fully known schedules walk 0 and 36 minutes, so the neutral value is
    18. Its two 10-minute gaps, less the 3-minute buffer, allow only 14.
    """
    results = _by_bundles(run(_fixture({}, ALPHA_BETA, None)))
    unknown = results[AA]
    assert unknown.metrics.walking_minutes_weekly == 0
    assert unknown.status == "needs_review"
    assert unknown.score == round(100 * math.exp(-14 / 30), 2) == 62.71
    assert unknown.score < results[BB].score == 100.0


def test_missing_walking_time_does_not_earn_a_perfect_idle_gap_score():
    results = _by_bundles(run(_fixture({"walking": 0, "idle_gap": 1}, ALPHA_BETA, None)))
    unknown = results[AA]
    assert unknown.metrics.idle_gap_minutes_weekly == 0
    assert unknown.score == round(100 * math.exp(-(20 - 14) / 60), 2)
    assert unknown.score < 100.0


def test_ready_schedules_rank_above_review_schedules_with_higher_scores():
    results = run(_fixture({}, ALPHA_BETA, None)).results
    assert [(tuple(bundle_ids(r)), r.status, r.score) for r in results] == [
        (BB, "ready", 100.0),
        (AB, "ready", 30.12),
        (AA, "needs_review", 62.71),
    ]


@pytest.mark.parametrize("weights", WEIGHT_MIXES)
def test_unknown_walk_scores_exactly_like_the_same_walk_at_the_assumed_length(weights):
    """Missing data is scored as one real, feasible week: here a 7-minute walk each day."""
    missing = _by_bundles(run(_fixture(weights, ALPHA_BETA, None)))[AA]
    known = _by_bundles(run(_fixture(weights, ALPHA_BETA, 7)))[AA]
    assert known.status == "ready"
    assert missing.score == known.score


@pytest.mark.parametrize(
    "edge_index, schedule, longest_feasible", [(ALPHA_BETA, AA, 7), (ALPHA_GAMMA, AB, 30)]
)
def test_unknown_walk_never_scores_outside_what_a_real_walk_could(edge_index, schedule, longest_feasible):
    """0 minutes is the best case for walking and the worst for idle time; the
    longest walk the gap allows is the reverse. The estimate stays in between."""

    def score(weights: dict, minutes: int | None) -> float:
        return _by_bundles(run(_fixture(weights, edge_index, minutes)))[schedule].score

    walking, idle = {"walking": 1}, {"walking": 0, "idle_gap": 1}
    assert score(walking, longest_feasible) <= score(walking, None) <= score(walking, 0)
    assert score(idle, 0) <= score(idle, None) <= score(idle, longest_feasible)


def test_unknown_walk_with_nothing_to_compare_against_uses_the_fallback():
    payload = request(
        [
            course("x", [bundle("x-A", [meeting("MON", 600, 650, "ALPHA")])]),
            course("y", [bundle("y-A", [meeting("MON", 700, 750, "BETA")])]),
        ],
        weights={"walking": 1, "idle_gap": 1},
    )
    result = run(payload).results[0]
    assert result.status == "needs_review"
    assert result.score == round(
        100 * (0.5 + math.exp(-(50 - FALLBACK_WALKING_MIN) / 60)) / 2, 2
    )


def test_large_known_walk_is_not_hidden_by_an_unknown_one():
    payload = request(
        [
            course("x", [bundle("x-A", [meeting("MON", 600, 650, "ALPHA")])]),
            course("y", [bundle("y-A", [meeting("MON", 700, 750, "BETA")])]),
            course("z", [bundle("z-A", [meeting("MON", 800, 850, "GAMMA")])]),
        ],
        [edge("ALPHA", "BETA", 40)],
    )
    result = run(payload).results[0]
    assert result.metrics.walking_minutes_weekly == 40
    assert result.score == round(100 * math.exp(-40 / 30), 2) < 50.0
