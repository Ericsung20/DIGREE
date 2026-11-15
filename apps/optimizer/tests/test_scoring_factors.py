"""The data-driven factors: grade outcomes, degree fit, instructor."""

import pytest

from app.models import GradeStats, Metrics, Weights
from app.scoring import (
    NOT_COMPARABLE_SCORE,
    DataFactor,
    data_factor,
    filled_mean,
    schedule_score,
    smoothed_grade_rate,
)
from tests.builders import WALKING_ONLY, bundle, bundle_ids, course, meeting, request, run

GRADE_ONLY = {"walking": 0, "grade_outcomes": 1}
FIT_ONLY = {"walking": 0, "degree_fit": 1}
INSTRUCTOR_ONLY = {"walking": 0, "instructor": 1}

NOT_COMPARABLE = (
    "score_not_comparable: None of the weighted preferences can tell these schedules apart; "
    "every score is a neutral 50 and the order follows course and section IDs."
)


def stats(rate: float, sample: int) -> dict:
    return {"a_ab_rate": rate, "sample_size": sample}


def required(course_id: str = "req", day: str = "MON") -> dict:
    return course(course_id, [bundle(f"{course_id}-A", [meeting(day, 600, 650)])])


def optional(course_id: str, day: str, **overrides) -> dict:
    return course(
        course_id,
        [bundle(f"{course_id}-A", [meeting(day, 600, 650)])],
        is_required=False,
        **overrides,
    )


def one_of(optional_courses: list[dict], weights: dict, **constraints) -> dict:
    """A required 3-credit course plus exactly one of the optional courses."""
    limits = {"min_credits": 6, "max_credits": 6, **constraints}
    return request([required(), *optional_courses], weights=weights, **limits)


def picks(response) -> list[tuple[str, float]]:
    """(the optional course, score) for each result, in rank order."""
    return [(r.selected[-1].course_id, r.score) for r in response.results]


def codes(result) -> list[str]:
    return [warning.split(": ")[0] for warning in result.warnings]


# --------------------------------------------------------------------------
# Building blocks
# --------------------------------------------------------------------------


def test_grade_rate_is_pulled_toward_one_half_by_small_samples():
    assert smoothed_grade_rate(GradeStats(a_ab_rate=1.0, sample_size=2)) == pytest.approx(27 / 52)
    assert smoothed_grade_rate(GradeStats(a_ab_rate=0.6, sample_size=500)) == pytest.approx(325 / 550)
    assert smoothed_grade_rate(GradeStats(a_ab_rate=0.0, sample_size=50)) == pytest.approx(0.25)
    assert smoothed_grade_rate(GradeStats(a_ab_rate=0.9, sample_size=10**6)) == pytest.approx(0.9, abs=1e-4)


def test_grade_rate_with_no_grades_is_missing_not_zero():
    assert smoothed_grade_rate(None) is None
    assert smoothed_grade_rate(GradeStats(a_ab_rate=0.0, sample_size=0)) is None
    assert smoothed_grade_rate(GradeStats(a_ab_rate=1.0, sample_size=0)) is None


def test_data_factor_needs_two_different_known_values_to_tell_schedules_apart():
    assert data_factor([]) == DataFactor(neutral=None, discriminating=False)
    assert data_factor([0.4]) == DataFactor(neutral=0.4, discriminating=False)
    assert data_factor([0.4, 0.4, 0.4]) == DataFactor(neutral=0.4, discriminating=False)
    assert data_factor([0.2, 0.8, 0.5]) == DataFactor(neutral=0.5, discriminating=True)
    assert data_factor([0.2, 0.8]).neutral == pytest.approx(0.5)
    assert not data_factor([]).has_data and data_factor([0.4]).has_data


def test_filled_mean_uses_the_neutral_value_for_missing_entries():
    assert filled_mean([0.9, None], neutral=0.5) == pytest.approx(0.7)
    assert filled_mean([None], neutral=0.5) == 0.5
    assert filled_mean([0.2, 0.4], neutral=0.99) == pytest.approx(0.3)


def _weights(**overrides) -> Weights:
    return Weights(**{**WALKING_ONLY, **overrides})


def _metrics(walking: int = 0) -> Metrics:
    return Metrics(
        total_credits=6, walking_minutes_weekly=walking, idle_gap_minutes_weekly=0, campus_days=1
    )


def test_data_factor_joins_the_weighted_average():
    data = {"grade_outcomes": 0.7}
    assert schedule_score(_metrics(), _weights(**GRADE_ONLY), data_values=data) == 70.0
    assert schedule_score(_metrics(), _weights(grade_outcomes=1), data_values=data) == 85.0
    assert schedule_score(_metrics(), _weights(grade_outcomes=0.5), data_values=data) == 90.0


def test_factor_that_is_not_compared_leaves_the_average():
    assert schedule_score(_metrics(), _weights(grade_outcomes=1)) == 100.0  # walking alone
    assert schedule_score(_metrics(), _weights(**GRADE_ONLY)) == NOT_COMPARABLE_SCORE == 50.0


# --------------------------------------------------------------------------
# Grade outcomes
# --------------------------------------------------------------------------


def test_perfect_rate_on_a_tiny_sample_does_not_beat_a_strong_rate_on_a_large_one():
    payload = one_of(
        [
            optional("tiny", "TUE", grade_stats=stats(1.0, 2)),
            optional("solid", "WED", grade_stats=stats(0.8, 400)),
        ],
        GRADE_ONLY,
    )
    assert picks(run(payload)) == [("solid", 76.67), ("tiny", 51.92)]


def test_t16_course_without_grade_statistics_is_not_scored_as_zero():
    payload = one_of(
        [
            optional("good", "TUE", grade_stats=stats(0.9, 450)),  # smoothed 0.86
            optional("poor", "WED", grade_stats=stats(0.2, 450)),  # smoothed 0.23
            optional("nodata", "THU"),
        ],
        GRADE_ONLY,
    )
    results = run(payload).results
    # The course without data takes the median of the known values, 0.545.
    assert picks(run(payload)) == [("good", 86.0), ("nodata", 54.5), ("poor", 23.0)]
    assert results[1].status == "ready"
    assert results[1].warnings == [
        "grade_data_missing: No grade statistics for NODATA; "
        "a neutral value was used for the grade preference."
    ]
    assert results[0].warnings == [] and results[2].warnings == []


def test_sample_size_of_zero_is_treated_like_missing_statistics():
    courses = [
        optional("good", "TUE", grade_stats=stats(0.9, 450)),
        optional("poor", "WED", grade_stats=stats(0.2, 450)),
    ]
    empty = run(one_of([*courses, optional("x", "THU", grade_stats=stats(0.0, 0))], GRADE_ONLY))
    absent = run(one_of([*courses, optional("x", "THU")], GRADE_ONLY))
    assert picks(empty) == picks(absent) == [("good", 86.0), ("x", 54.5), ("poor", 23.0)]


def test_grade_weight_with_no_statistics_at_all_is_reported_and_not_scored():
    payload = one_of([optional("a", "TUE"), optional("b", "WED")], {"grade_outcomes": 1})
    results = run(payload).results
    assert picks(run(payload)) == [("a", 100.0), ("b", 100.0)]  # walking alone
    for result in results:
        assert result.warnings == [
            "grade_data_missing: No grade statistics were provided for the optional courses; "
            "the grade preference did not affect the score."
        ]
        assert result.status == "ready"


def test_identical_grade_values_are_left_out_without_a_warning():
    same = stats(0.7, 300)
    payload = one_of(
        [optional("a", "TUE", grade_stats=same), optional("b", "WED", grade_stats=same)],
        {"grade_outcomes": 1},
    )
    results = run(payload).results
    assert picks(run(payload)) == [("a", 100.0), ("b", 100.0)]
    assert all(r.warnings == [] for r in results)


def test_grade_statistics_of_required_courses_do_not_enter_the_score():
    def payload(required_stats):
        req = required()
        req["grade_stats"] = required_stats
        return request(
            [
                req,
                optional("good", "TUE", grade_stats=stats(0.9, 450)),
                optional("poor", "WED", grade_stats=stats(0.2, 450)),
            ],
            weights=GRADE_ONLY,
            min_credits=6,
            max_credits=6,
        )

    assert picks(run(payload(None))) == picks(run(payload(stats(0.1, 900))))


# --------------------------------------------------------------------------
# Degree fit
# --------------------------------------------------------------------------


def test_higher_degree_fit_ranks_first():
    payload = one_of(
        [optional("low", "TUE", requirement_fit=0.4), optional("high", "WED", requirement_fit=0.9)],
        FIT_ONLY,
    )
    assert picks(run(payload)) == [("high", 90.0), ("low", 40.0)]


def test_degree_fit_is_the_mean_over_the_selected_optional_courses():
    payload = request(
        [
            required(),
            optional("a", "TUE", requirement_fit=1.0),
            optional("b", "WED", requirement_fit=0.5),
            optional("c", "THU", requirement_fit=0.0),
        ],
        weights=FIT_ONLY,
        min_credits=9,
        max_credits=9,
    )
    results = run(payload).results
    assert [([s.course_id for s in r.selected][1:], r.score) for r in results] == [
        (["a", "b"], 75.0),
        (["a", "c"], 50.0),
        (["b", "c"], 25.0),
    ]


def test_missing_degree_fit_takes_the_neutral_value():
    payload = one_of(
        [
            optional("high", "TUE", requirement_fit=0.9),
            optional("low", "WED", requirement_fit=0.3),
            optional("unknown", "THU"),
        ],
        FIT_ONLY,
    )
    results = run(payload).results
    assert picks(run(payload)) == [("high", 90.0), ("unknown", 60.0), ("low", 30.0)]
    assert results[1].warnings == [
        "degree_fit_data_missing: No degree-fit value for UNKNOWN; "
        "a neutral value was used for the degree-fit preference."
    ]


def test_degree_fit_of_required_courses_does_not_enter_the_score():
    def payload(required_fit):
        req = required()
        req["requirement_fit"] = required_fit
        return request(
            [req, optional("low", "TUE", requirement_fit=0.4), optional("high", "WED", requirement_fit=0.9)],
            weights=FIT_ONLY,
            min_credits=6,
            max_credits=6,
        )

    assert picks(run(payload(None))) == picks(run(payload(1.0))) == [("high", 90.0), ("low", 40.0)]


def test_degree_fit_weight_with_no_values_is_reported():
    payload = one_of([optional("a", "TUE"), optional("b", "WED")], {"degree_fit": 1})
    for result in run(payload).results:
        assert result.score == 100.0
        assert result.warnings == [
            "degree_fit_data_missing: No degree-fit values were provided for the optional "
            "courses; the degree-fit preference did not affect the score."
        ]


# --------------------------------------------------------------------------
# Instructor
# --------------------------------------------------------------------------


def rated(bundle_id: str, day: str, rating: float | None, **kwargs) -> dict:
    return {**bundle(bundle_id, [meeting(day, 600, 650)], **kwargs), "instructor_score": rating}


def test_sections_of_one_course_are_ranked_by_instructor_rating():
    payload = request(
        [course("x", [rated("x-low", "MON", 0.4), rated("x-high", "TUE", 0.9)])],
        weights=INSTRUCTOR_ONLY,
    )
    results = run(payload).results
    assert [(bundle_ids(r), r.score) for r in results] == [(["x-high"], 90.0), (["x-low"], 40.0)]


def test_t16_section_without_an_instructor_rating_is_not_scored_as_zero():
    payload = request(
        [
            course(
                "x",
                [rated("x-good", "MON", 0.9), rated("x-poor", "TUE", 0.3), rated("x-new", "WED", None)],
            )
        ],
        weights=INSTRUCTOR_ONLY,
    )
    results = run(payload).results
    assert [(bundle_ids(r), r.score) for r in results] == [
        (["x-good"], 90.0),
        (["x-new"], 60.0),  # the median of 0.9 and 0.3
        (["x-poor"], 30.0),
    ]
    assert results[1].status == "ready"
    assert results[1].warnings == [
        "instructor_data_missing: No instructor rating for X (x-new); "
        "a neutral value was used for the instructor preference."
    ]


def test_instructor_value_is_the_mean_over_every_selected_section():
    payload = request(
        [
            course("x", [rated("x-A", "MON", 1.0), rated("x-B", "TUE", 0.0)]),
            course("y", [rated("y-A", "WED", 0.5)]),
        ],
        weights=INSTRUCTOR_ONLY,
    )
    results = run(payload).results
    assert [(bundle_ids(r), r.score) for r in results] == [
        (["x-A", "y-A"], 75.0),
        (["x-B", "y-A"], 25.0),
    ]


def test_ratings_that_differ_only_between_fixed_courses_cannot_be_compared():
    """Both sections of X share a rating and Y has one section: every schedule gets the same value."""
    payload = request(
        [
            course("x", [rated("x-A", "MON", 0.9), rated("x-B", "TUE", 0.9)]),
            course("y", [rated("y-A", "WED", 0.2)]),
        ],
        weights=INSTRUCTOR_ONLY,
    )
    results = run(payload).results
    assert [(bundle_ids(r), r.score) for r in results] == [
        (["x-A", "y-A"], 50.0),
        (["x-B", "y-A"], 50.0),
    ]
    assert all(r.warnings == [NOT_COMPARABLE] for r in results)


def test_instructor_ratings_matter_between_optional_courses():
    payload = one_of(
        [
            course("a", [rated("a-A", "TUE", 0.2)], is_required=False),
            course("b", [rated("b-A", "WED", 0.8)], is_required=False),
        ],
        INSTRUCTOR_ONLY,
    )
    # The required section has no rating and takes the median of 0.2 and 0.8.
    results = run(payload).results
    assert picks(run(payload)) == [("b", 65.0), ("a", 35.0)]
    assert all(codes(r) == ["instructor_data_missing"] for r in results)


# --------------------------------------------------------------------------
# Combining factors, and having none left
# --------------------------------------------------------------------------


def test_factors_are_averaged_by_weight():
    payload = request(
        [course("x", [rated("x-low", "MON", 0.4), rated("x-high", "TUE", 0.9)])],
        weights={"walking": 1, "instructor": 1},
    )
    results = run(payload).results
    assert [(bundle_ids(r), r.score) for r in results] == [(["x-high"], 95.0), (["x-low"], 70.0)]


def test_all_six_weights_together():
    payload = request(
        [
            course("req", [rated("req-A", "MON", 0.8)]),
            course(
                "a",
                [rated("a-A", "TUE", 0.6)],
                is_required=False,
                requirement_fit=1.0,
                grade_stats=stats(0.9, 450),
            ),
            course(
                "b",
                [rated("b-A", "WED", 1.0)],
                is_required=False,
                requirement_fit=0.5,
                grade_stats=stats(0.2, 450),
            ),
        ],
        weights=dict.fromkeys(WALKING_ONLY, 1),
        min_credits=6,
        max_credits=6,
    )
    results = run(payload).results
    # walking 1, idle 1, campus days 0.75 for both (two days on campus).
    with_a = 100 * (1 + 1 + 0.75 + 0.86 + 1.0 + (0.8 + 0.6) / 2) / 6
    with_b = 100 * (1 + 1 + 0.75 + 0.23 + 0.5 + (0.8 + 1.0) / 2) / 6
    assert picks(run(payload)) == [("a", round(with_a, 2)), ("b", round(with_b, 2))]
    assert all(r.warnings == [] and r.status == "ready" for r in results)


def test_no_comparable_factor_gives_a_neutral_score_in_id_order():
    """Degree fit is the only weight, and no optional course is in play."""
    payload = request(
        [
            course(
                "x",
                [bundle("x-B", [meeting("TUE", 600, 650)]), bundle("x-A", [meeting("MON", 600, 650)])],
            )
        ],
        weights=FIT_ONLY,
    )
    results = run(payload).results
    assert [(bundle_ids(r), r.score, r.status) for r in results] == [
        (["x-A"], 50.0, "ready"),
        (["x-B"], 50.0, "ready"),
    ]
    assert all(r.warnings == [NOT_COMPARABLE] for r in results)


def test_weight_with_no_data_and_nothing_else_reports_both_facts():
    payload = one_of([optional("a", "TUE"), optional("b", "WED")], GRADE_ONLY)
    for result in run(payload).results:
        assert result.score == 50.0
        assert codes(result) == ["grade_data_missing", "score_not_comparable"]


# --------------------------------------------------------------------------
# Advisory warnings
# --------------------------------------------------------------------------


def test_advisory_warnings_follow_review_warnings_and_do_not_set_the_status():
    payload = request(
        [
            course(
                "x",
                [
                    rated("x-A", "MON", None, seat_status="unknown"),
                    rated("x-B", "TUE", None),
                    rated("x-C", "WED", 0.9),
                    rated("x-D", "THU", 0.2),
                ],
            )
        ],
        weights=INSTRUCTOR_ONLY,
    )
    by_bundle = {bundle_ids(r)[0]: r for r in run(payload).results}
    assert codes(by_bundle["x-A"]) == ["seat_status_unknown", "instructor_data_missing"]
    assert by_bundle["x-A"].status == "needs_review"
    assert codes(by_bundle["x-B"]) == ["instructor_data_missing"]
    assert by_bundle["x-B"].status == "ready"
    assert by_bundle["x-C"].warnings == [] and by_bundle["x-C"].status == "ready"


def test_missing_data_is_not_penalised_against_poor_known_data():
    """A new section with no rating must not rank below one known to be poor."""
    payload = request(
        [course("x", [rated("x-poor", "MON", 0.1), rated("x-new", "TUE", None), rated("x-ok", "WED", 0.6)])],
        weights=INSTRUCTOR_ONLY,
    )
    order = [bundle_ids(r)[0] for r in run(payload).results]
    assert order.index("x-new") < order.index("x-poor")
