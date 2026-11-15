"""Preferred breadth changes rankings and the bounded optional shortlist."""

from app.config import SearchLimits
from tests.builders import bundle, course, meeting, request, run


def candidates() -> list[dict]:
    return [
        course("required", [bundle("required-A", [meeting("MON", 600, 650)])]),
        course("other", [bundle("other-A", [meeting("TUE", 600, 650)])],
               is_required=False, breadth=["S"], requirement_fit=0.9),
        course("preferred", [bundle("preferred-A", [meeting("WED", 600, 650)])],
               is_required=False, breadth=["H"], requirement_fit=0.1),
    ]


def payload() -> dict:
    body = request(candidates(), min_credits=6, max_credits=6, weights={"walking": 0, "breadth": 1})
    body["preferences"]["preferred_breadths"] = ["h"]
    return body


def test_preferred_breadth_ranks_matching_optional_course_first():
    results = run(payload()).results
    assert [result.selected[-1].course_id for result in results] == ["preferred", "other"]
    assert [result.score for result in results] == [100, 0]


def test_preferred_breadth_survives_optional_shortlist_limit():
    results = run(payload(), SearchLimits(max_optional_courses=1)).results
    assert results[0].selected[-1].course_id == "preferred"


def test_absent_preference_preserves_existing_degree_fit_shortlist():
    body = payload()
    body["preferences"].pop("preferred_breadths")
    body["preferences"]["weights"].pop("breadth")
    body["preferences"]["weights"]["degree_fit"] = 1
    results = run(body, SearchLimits(max_optional_courses=1)).results
    assert results[0].selected[-1].course_id == "other"


def test_multiple_designations_are_a_union_not_an_intersection():
    body = payload()
    body["preferences"]["preferred_breadths"] = ["H", "S"]
    body["courses"].append(course("neither", [bundle("neither-A", [meeting("THU", 600, 650)])],
                                  is_required=False, breadth=["N"], requirement_fit=0.8))
    results = run(body, SearchLimits(max_optional_courses=2)).results
    assert {result.selected[-1].course_id for result in results} == {"other", "preferred"}
