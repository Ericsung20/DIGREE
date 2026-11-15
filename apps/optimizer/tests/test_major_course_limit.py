"""The major-course cap includes required and optional courses."""

from tests.builders import WALKING_ONLY, bundle, course, meeting, request, run


def payload(limit: int | None) -> dict:
    courses = [
        course("required-major", [bundle("required-A", [meeting("MON", 600, 650)])], is_major_course=True),
        course("optional-major", [bundle("major-A", [meeting("TUE", 600, 650)])], is_required=False, is_major_course=True),
        course("elective", [bundle("elective-A", [meeting("WED", 600, 650)])], is_required=False),
    ]
    return request(courses, min_credits=6, max_credits=6, max_major_courses=limit)


def test_major_cap_excludes_a_second_major_course():
    results = run(payload(1)).results
    assert [result.selected[-1].course_id for result in results] == ["elective"]


def test_major_cap_also_applies_to_the_full_catalog_search():
    body = payload(1)
    body["preferences"].update(catalog_search=True, preferred_breadths=["S"])
    body["courses"][1]["breadth"] = ["S"]
    body["courses"][2]["breadth"] = ["S"]
    response = run(body)
    assert [result.selected[-1].course_id for result in response.results] == ["elective"]
    assert "max_major_courses_exceeded" in response.diagnostics.rejected_by_reason


def test_unlimited_or_two_major_courses_allows_both_choices():
    assert len(run(payload(None)).results) == 2
    assert len(run(payload(2)).results) == 2


def test_cap_below_required_major_count_explains_empty_result():
    result = run(payload(0))
    assert not result.results
    assert "max_major_courses_exceeded" in result.diagnostics.no_results_reasons


def test_balanced_preference_favors_two_major_courses_without_requiring_them():
    result = run({**payload(None), "preferences": {"weights": {**WALKING_ONLY, "walking": 0, "major_balance": 1}}})
    assert [item.selected[-1].course_id for item in result.results] == ["optional-major", "elective"]
    assert result.results[0].score > result.results[1].score


def test_zero_balance_weight_is_neutral():
    result = run({**payload(None), "preferences": {"weights": {**WALKING_ONLY, "major_balance": 0}}})
    assert len({item.score for item in result.results}) == 1
