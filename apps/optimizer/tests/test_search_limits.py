"""Search limits: the step cap, the optional-course shortlist, and their configuration."""

import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import SearchLimits, load_search_limits
from tests.builders import bundle, bundle_ids, course, meeting, request, run

DAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")

SEARCH_INCOMPLETE = (
    "search_incomplete: The search stopped before examining every combination; "
    "better schedules may exist."
)


def _wide_request(courses: int = 4, bundles: int = 4) -> dict:
    """Courses on separate days, so every one of bundles ** courses combinations is feasible."""
    return request(
        [
            course(
                f"c{c}",
                [bundle(f"c{c}-{b}", [meeting(DAYS[c], 600 + 60 * b, 650 + 60 * b)]) for b in range(bundles)],
            )
            for c in range(courses)
        ]
    )


def optional(course_id: str, day: str, **overrides) -> dict:
    return course(
        course_id,
        [bundle(f"{course_id}-A", [meeting(day, 600, 650)])],
        is_required=False,
        **overrides,
    )


def _one_required_and(optional_courses: list[dict]) -> dict:
    required = course("req", [bundle("req-A", [meeting("SUN", 600, 650)])])
    return request([required, *optional_courses], min_credits=6, max_credits=6)


# --------------------------------------------------------------------------
# Step cap
# --------------------------------------------------------------------------


def test_default_limits():
    assert SearchLimits() == SearchLimits(max_search_steps=100_000, max_optional_courses=20)


def test_search_within_the_cap_is_complete():
    response = run(_wide_request())
    assert response.diagnostics.search_truncated is False
    assert response.diagnostics.explored_combinations == 256
    assert all(r.warnings == [] for r in response.results)


def test_t18_step_cap_truncates_the_search_and_says_so():
    response = run(_wide_request(), SearchLimits(max_search_steps=50))
    assert response.diagnostics.search_truncated is True
    assert response.results
    for result in response.results:
        assert result.warnings == [SEARCH_INCOMPLETE]
        assert result.status == "ready"  # advisory: it does not question feasibility
    assert response.diagnostics.no_results_reasons == []


def test_truncated_search_counts_only_what_it_examined():
    response = run(_wide_request(), SearchLimits(max_search_steps=50))
    examined = response.diagnostics.explored_combinations
    assert 0 < examined < 256
    assert examined <= 50
    assert sum(response.diagnostics.rejected_by_reason.values()) <= examined


def test_truncated_search_is_reproducible():
    limits = SearchLimits(max_search_steps=50)
    assert run(_wide_request(), limits).model_dump_json() == run(_wide_request(), limits).model_dump_json()


def test_more_steps_never_examine_fewer_combinations():
    counts = [
        run(_wide_request(), SearchLimits(max_search_steps=steps)).diagnostics.explored_combinations
        for steps in (10, 50, 200, 1000)
    ]
    assert counts == sorted(counts)
    assert counts[-1] == 256


def test_truncation_before_any_result_does_not_claim_that_none_exists():
    response = run(_wide_request(), SearchLimits(max_search_steps=2))
    assert response.results == []
    assert response.diagnostics.search_truncated is True
    assert response.diagnostics.explored_combinations == 0
    assert response.diagnostics.no_results_reasons == ["search_truncated"]


def test_truncation_is_listed_before_the_rejections_seen_so_far():
    payload = request(
        [
            course("x", [bundle("x-A", [meeting("MON", 600, 650)])]),
            course(
                "y",
                [
                    bundle("y-clash", [meeting("MON", 600, 650)]),
                    bundle("y-B", [meeting("TUE", 600, 650)]),
                    bundle("y-C", [meeting("WED", 600, 650)]),
                ],
            ),
        ]
    )
    response = run(payload, SearchLimits(max_search_steps=2))
    assert response.results == []
    assert response.diagnostics.no_results_reasons == ["search_truncated", "time_overlap"]


@pytest.mark.parametrize("steps, truncated, found", [(4, False, 2), (3, True, 1)])
def test_cap_that_is_exactly_enough_is_not_a_truncation(steps, truncated, found):
    """One course with two sections needs four steps: two placements and two evaluations."""
    payload = request(
        [course("x", [bundle("x-A", [meeting("MON", 600, 650)]), bundle("x-B", [meeting("TUE", 600, 650)])])]
    )
    response = run(payload, SearchLimits(max_search_steps=steps))
    assert response.diagnostics.search_truncated is truncated
    assert len(response.results) == found


def test_score_of_a_schedule_does_not_depend_on_the_cap():
    """Neutral values come from the whole request, not from the sections reached in time."""
    ratings = {"x-A": 0.9, "x-B": None, "x-C": 0.5, "x-D": 0.1}
    payload = request(
        [
            course(
                "x",
                [
                    {**bundle(name, [meeting(DAYS[i], 600, 650)]), "instructor_score": rating}
                    for i, (name, rating) in enumerate(ratings.items())
                ],
            )
        ],
        weights={"walking": 0, "instructor": 1},
    )
    complete = {bundle_ids(r)[0]: r.score for r in run(payload).results}
    capped = run(payload, SearchLimits(max_search_steps=4))  # reaches x-A and x-B only
    assert capped.diagnostics.search_truncated is True
    assert {bundle_ids(r)[0]: r.score for r in capped.results} == {"x-A": 90.0, "x-B": 50.0}
    assert complete["x-A"] == 90.0 and complete["x-B"] == 50.0


# --------------------------------------------------------------------------
# Optional-course shortlist
# --------------------------------------------------------------------------


def test_shortlist_keeps_the_best_degree_fit_and_marks_the_search_truncated():
    payload = _one_required_and(
        [
            optional("a", "MON"),
            optional("b", "TUE", requirement_fit=0.2),
            optional("c", "WED", requirement_fit=0.9),
            optional("d", "THU"),
            optional("e", "FRI", requirement_fit=0.5),
        ]
    )
    response = run(payload, SearchLimits(max_optional_courses=2))
    assert sorted(r.selected[-1].course_id for r in response.results) == ["c", "e"]
    assert response.diagnostics.search_truncated is True
    assert all(r.warnings == [SEARCH_INCOMPLETE] for r in response.results)


def test_shortlist_ties_go_to_the_lower_course_id_whatever_the_request_order():
    names = ["e", "c", "a", "d", "b"]
    forward = _one_required_and([optional(n, DAYS[i]) for i, n in enumerate(names)])
    backward = _one_required_and([optional(n, DAYS[i]) for i, n in reversed(list(enumerate(names)))])
    limits = SearchLimits(max_optional_courses=2)
    for payload in (forward, backward):
        assert sorted(r.selected[-1].course_id for r in run(payload, limits).results) == ["a", "b"]


def test_shortlist_that_fits_every_usable_course_is_not_a_truncation():
    payload = _one_required_and(
        [
            optional("a", "MON"),
            optional("b", "TUE"),
            optional("gone", "WED", eligibility_status="ineligible"),
        ]
    )
    response = run(payload, SearchLimits(max_optional_courses=2))
    assert response.diagnostics.search_truncated is False
    assert all(r.warnings == [] for r in response.results)


def test_shortlist_is_not_applied_when_optional_courses_are_not_needed():
    payload = request(
        [course("req", [bundle("req-A", [meeting("SUN", 600, 650)])])]
        + [optional(n, DAYS[i]) for i, n in enumerate("abcde")]
    )
    response = run(payload, SearchLimits(max_optional_courses=1))
    assert response.diagnostics.search_truncated is False
    assert [bundle_ids(r) for r in response.results] == [["req-A"]]


def test_large_candidate_set_is_answered_within_the_default_limits():
    """30 optional courses of 3 sections each, up to 4 of them per schedule."""
    pool = [
        course(
            f"opt{n:02d}",
            [bundle(f"opt{n:02d}-{b}", [meeting(DAYS[(n + b) % 6], 480 + 55 * (n % 9), 530 + 55 * (n % 9))]) for b in range(3)],
            is_required=False,
            requirement_fit=(n % 10) / 10,
        )
        for n in range(30)
    ]
    required = course("req", [bundle("req-A", [meeting("SUN", 600, 650)])])
    payload = request([required, *pool], min_credits=9, max_credits=15)
    response = run(payload)
    assert response.diagnostics.search_truncated is True
    assert len(response.results) == 5
    assert response.diagnostics.explored_combinations > 0
    assert all("search_incomplete" in r.warnings[-1] for r in response.results)
    assert all(9 <= r.metrics.total_credits <= 15 for r in response.results)
    assert run(payload).model_dump_json() == response.model_dump_json()


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------


def test_limits_default_when_the_environment_is_silent():
    assert load_search_limits({}) == SearchLimits()
    assert load_search_limits({"DIGREE_MAX_SEARCH_STEPS": "  ", "DIGREE_MAX_OPTIONAL_COURSES": ""}) == SearchLimits()


def test_limits_are_read_from_the_environment():
    limits = load_search_limits({"DIGREE_MAX_SEARCH_STEPS": "2500", "DIGREE_MAX_OPTIONAL_COURSES": " 8 "})
    assert limits == SearchLimits(max_search_steps=2500, max_optional_courses=8)


@pytest.mark.parametrize(
    "name, value",
    [
        ("DIGREE_MAX_SEARCH_STEPS", "many"),
        ("DIGREE_MAX_SEARCH_STEPS", "1.5"),
        ("DIGREE_MAX_SEARCH_STEPS", "0"),
        ("DIGREE_MAX_SEARCH_STEPS", "-10"),
        ("DIGREE_MAX_SEARCH_STEPS", "99999999999"),
        ("DIGREE_MAX_OPTIONAL_COURSES", "twenty"),
        ("DIGREE_MAX_OPTIONAL_COURSES", "0"),
        ("DIGREE_MAX_OPTIONAL_COURSES", "201"),
    ],
)
def test_invalid_limit_is_refused_with_the_variable_named(name, value):
    with pytest.raises(ValueError, match=name) as error:
        load_search_limits({name: value})
    assert value in str(error.value)


@pytest.mark.parametrize("kwargs", [{"max_search_steps": 0}, {"max_optional_courses": -1}, {"max_search_steps": True}, {"max_search_steps": 2.0}])
def test_limits_object_validates_its_values(kwargs):
    with pytest.raises(ValueError):
        SearchLimits(**kwargs)


def test_api_applies_the_configured_limits(monkeypatch):
    assert isinstance(main.SEARCH_LIMITS, SearchLimits)
    monkeypatch.setattr(main, "SEARCH_LIMITS", SearchLimits(max_search_steps=50))
    response = TestClient(main.app).post("/v1/schedules/generate", json=_wide_request())
    assert response.status_code == 200
    body = response.json()
    assert body["diagnostics"]["search_truncated"] is True
    assert all(result["warnings"] == [SEARCH_INCOMPLETE] for result in body["results"])
