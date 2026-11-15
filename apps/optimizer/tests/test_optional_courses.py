"""Optional-course selection: when courses are added, which ones, and how they are counted."""

from itertools import product

import pytest

from tests.builders import bundle, bundle_ids, course, meeting, request, run

DAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


def required(course_id: str = "req", day: str = "MON", credits: tuple[int, ...] = (3,)) -> dict:
    return course(course_id, [bundle(f"{course_id}-A", [meeting(day, 600, 650)])], credits=credits)


def optional(course_id: str, day: str, credits: tuple[int, ...] = (3,), **overrides) -> dict:
    return course(
        course_id,
        [bundle(f"{course_id}-A", [meeting(day, 600, 650)])],
        credits=credits,
        is_required=False,
        **overrides,
    )


def course_ids(result) -> list[str]:
    return [selected.course_id for selected in result.selected]


# --------------------------------------------------------------------------
# When optional courses are added
# --------------------------------------------------------------------------


def test_t08_optional_courses_fill_the_credit_range():
    payload = request(
        [required(), optional("a", "TUE"), optional("b", "WED")], min_credits=6, max_credits=6
    )
    response = run(payload)
    assert [course_ids(r) for r in response.results] == [["req", "a"], ["req", "b"]]
    assert all(r.metrics.total_credits == 6 for r in response.results)
    assert all(r.status == "ready" for r in response.results)
    # req x (a or not) x (b or not): both is too many credits, neither too few.
    assert response.diagnostics.explored_combinations == 4
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 2}


def test_optional_courses_are_not_added_when_required_courses_reach_the_range():
    payload = request(
        [required(credits=(12,)), optional("a", "TUE"), optional("b", "WED")],
        min_credits=12,
        max_credits=18,
    )
    response = run(payload)
    assert [course_ids(r) for r in response.results] == [["req"]]
    assert response.results[0].metrics.total_credits == 12
    assert response.diagnostics.explored_combinations == 1


def test_every_optional_set_inside_the_range_is_a_candidate():
    """9 required credits and a 12-18 range: 12, 15 and 18 credits are all valid."""
    payload = request(
        [
            required(credits=(9,)),
            optional("a", "TUE"),
            optional("b", "WED"),
            optional("c", "THU"),
        ],
        min_credits=12,
        max_credits=18,
    )
    response = run(payload)
    assert response.diagnostics.explored_combinations == 8  # req x 2 x 2 x 2
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 1}  # no optional
    assert {r.metrics.total_credits for r in response.results} == {12, 15, 18}
    assert len(response.results) == 5  # top_k of the 7 valid schedules


def test_required_courses_are_in_every_schedule():
    payload = request(
        [
            optional("a", "TUE"),
            required("r1", "MON"),
            optional("b", "WED"),
            required("r2", "THU"),
        ],
        min_credits=9,
        max_credits=12,
    )
    results = run(payload).results
    assert results
    for result in results:
        assert {"r1", "r2"} <= set(course_ids(result))


def test_selected_courses_keep_request_order_and_are_named_in_the_reasons():
    payload = request(
        [optional("b", "WED"), required(), optional("a", "TUE")], min_credits=9, max_credits=9
    )
    result = run(payload).results[0]
    assert course_ids(result) == ["b", "req", "a"]
    assert result.reasons == [
        "All selected courses fit; weekly between-class walking: 0 min.",
        "Optional courses selected: B, A.",
    ]


# --------------------------------------------------------------------------
# Variable credits
# --------------------------------------------------------------------------


def test_variable_credit_optional_course_uses_each_option_that_fits():
    payload = request(
        [required(), optional("var", "TUE", credits=(1, 2, 3, 4))], min_credits=5, max_credits=6
    )
    response = run(payload)
    assert [(course_ids(r), r.metrics.total_credits) for r in response.results] == [
        (["req", "var"], 5),
        (["req", "var"], 6),
    ]
    assert [r.selected[1].credits for r in response.results] == [2, 3]
    # Four credit options plus leaving the course out; 1 and none are too few, 4 too many.
    assert response.diagnostics.explored_combinations == 5
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 3}


def test_variable_credit_required_course_combines_with_an_optional_one():
    payload = request(
        [required(credits=(3, 4)), optional("a", "TUE")], min_credits=7, max_credits=7
    )
    response = run(payload)
    assert [[(s.course_id, s.credits) for s in r.selected] for r in response.results] == [
        [("req", 4), ("a", 3)]
    ]


def test_optional_courses_join_only_when_no_required_credit_option_reaches_the_range():
    reachable = request(
        [required(credits=(3, 6)), optional("a", "TUE")], min_credits=6, max_credits=9
    )
    assert [course_ids(r) for r in run(reachable).results] == [["req"]]

    unreachable = request(
        [required(credits=(3, 4)), optional("a", "TUE")], min_credits=6, max_credits=9
    )
    assert all("a" in course_ids(r) for r in run(unreachable).results)


# --------------------------------------------------------------------------
# Which optional courses can be used
# --------------------------------------------------------------------------


def _mixed_pool() -> list[dict]:
    return [
        required(),
        optional("ok", "TUE"),
        optional("inel", "WED", eligibility_status="ineligible"),
        optional("done", "THU", already_completed=True, repeatable=False),
        optional("again", "FRI", already_completed=True, repeatable=True),
        course("nobundles", [], is_required=False),
        optional("unk", "SAT", eligibility_status="unknown"),
    ]


def test_t09_invalid_optional_courses_are_never_selected():
    response = run(request(_mixed_pool(), min_credits=6, max_credits=12))
    selected = {course_id for r in response.results for course_id in course_ids(r)}
    assert selected <= {"req", "ok", "again", "unk"}
    assert {"ok", "again"} <= selected
    # req x (ok, again, unk each in or out): the three unusable courses add nothing.
    assert response.diagnostics.explored_combinations == 8


def test_optional_course_with_unknown_eligibility_is_usable_but_needs_review():
    payload = request(
        [required(), optional("ok", "TUE"), optional("unk", "SAT", eligibility_status="unknown")],
        min_credits=6,
        max_credits=6,
    )
    results = run(payload).results
    assert [(course_ids(r), r.status) for r in results] == [
        (["req", "ok"], "ready"),
        (["req", "unk"], "needs_review"),
    ]
    assert results[1].warnings == [
        "eligibility_unknown: Eligibility for UNK has not been confirmed; "
        "check its requisites before enrolling."
    ]


def test_no_usable_optional_course_is_reported():
    payload = request(
        [required(), optional("inel", "TUE", eligibility_status="ineligible")],
        min_credits=6,
        max_credits=6,
    )
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.explored_combinations == 1
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 1}
    assert response.diagnostics.no_results_reasons == [
        "no_usable_optional_courses",
        "credits_out_of_range",
    ]


def test_full_optional_section_is_excluded_like_any_other():
    payload = request(
        [
            required(),
            course(
                "a",
                [
                    bundle("a-full", [meeting("TUE", 600, 650)], seat_status="full"),
                    bundle("a-open", [meeting("WED", 600, 650)]),
                ],
                is_required=False,
            ),
        ],
        min_credits=6,
        max_credits=6,
        exclude_full_sections=True,
    )
    response = run(payload)
    assert [bundle_ids(r) for r in response.results] == [["req-A", "a-open"]]
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 1, "section_full": 1}


# --------------------------------------------------------------------------
# No required courses
# --------------------------------------------------------------------------


def test_schedule_of_optional_courses_only():
    payload = request([optional("a", "TUE"), optional("b", "WED")], min_credits=4, max_credits=6)
    response = run(payload)
    assert [course_ids(r) for r in response.results] == [["a", "b"]]
    # Both; a alone; b alone. The empty selection is not a combination.
    assert response.diagnostics.explored_combinations == 3
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 2}


def test_minimum_of_zero_never_returns_an_empty_schedule():
    payload = request([optional("a", "TUE"), optional("b", "WED")], min_credits=0, max_credits=3)
    response = run(payload)
    assert [course_ids(r) for r in response.results] == [["a"], ["b"]]
    assert all(r.selected and r.metrics.total_credits == 3 for r in response.results)
    assert response.diagnostics.explored_combinations == 3
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 1}


def test_maximum_of_zero_has_no_non_empty_schedule():
    """The range is respected as given: nothing is returned, and the diagnostics say why."""
    payload = request([optional("a", "TUE"), optional("b", "WED")], min_credits=0, max_credits=0)
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 3}
    assert response.diagnostics.no_results_reasons == ["credits_out_of_range"]
    assert response.diagnostics.search_truncated is False


def test_no_required_course_and_no_usable_optional_one():
    payload = request([optional("inel", "TUE", eligibility_status="ineligible")], min_credits=3)
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.explored_combinations == 0
    assert response.diagnostics.no_results_reasons == ["no_usable_optional_courses"]


# --------------------------------------------------------------------------
# No duplicates, and counts that match an independent enumeration
# --------------------------------------------------------------------------


def _tangled_request() -> dict:
    """One required and three optional courses with overlapping sections."""
    return request(
        [
            course(
                "r",
                [bundle("r-A", [meeting("MON", 600, 650)]), bundle("r-B", [meeting("TUE", 600, 650)])],
            ),
            course(
                "a",
                [bundle("a-A", [meeting("MON", 630, 680)]), bundle("a-B", [meeting("WED", 600, 650)])],
                is_required=False,
            ),
            course("b", [bundle("b-A", [meeting("TUE", 620, 700)])], credits=(1, 2), is_required=False),
            course("c", [bundle("c-A", [meeting("WED", 640, 700)])], is_required=False),
        ],
        min_credits=6,
        max_credits=9,
    )


def _brute_force(payload: dict) -> tuple[int, int]:
    """(all combinations, feasible ones), enumerated without the engine."""
    options = []
    for candidate in payload["courses"]:
        taken = [
            (candidate["course_id"], b, credits)
            for credits in candidate["credit_options"]
            for b in candidate["section_bundles"]
        ]
        options.append(taken if candidate["is_required"] else taken + [None])

    def overlaps(first: dict, second: dict) -> bool:
        return any(
            m["day"] == n["day"] and m["start_min"] < n["end_min"] and n["start_min"] < m["end_min"]
            for m in first["meetings"]
            for n in second["meetings"]
        )

    limits = payload["constraints"]
    total = feasible = 0
    for combination in product(*options):
        chosen = [choice for choice in combination if choice is not None]
        if not chosen:
            continue
        total += 1
        credits = sum(choice[2] for choice in chosen)
        clash = any(overlaps(x[1], y[1]) for i, x in enumerate(chosen) for y in chosen[i + 1 :])
        if limits["min_credits"] <= credits <= limits["max_credits"] and not clash:
            feasible += 1
    return total, feasible


def test_counts_match_an_independent_enumeration():
    payload = _tangled_request()
    total, feasible = _brute_force(payload)
    assert (total, feasible) == (36, 10)  # by hand: 6 schedules with r-A, 4 with r-B

    diagnostics = run(payload).diagnostics
    assert diagnostics.explored_combinations == total
    assert total - sum(diagnostics.rejected_by_reason.values()) == feasible
    assert set(diagnostics.rejected_by_reason) == {"credits_out_of_range", "time_overlap"}


def test_no_schedule_is_returned_twice():
    payload = _tangled_request()
    payload["top_k"] = 5
    results = run(payload).results
    keys = [tuple((s.course_id, s.bundle_id, s.credits) for s in r.selected) for r in results]
    assert len(keys) == 5
    assert len(set(keys)) == len(keys)


def test_results_do_not_depend_on_the_order_of_the_request():
    payload = _tangled_request()
    original = run(payload)

    payload["courses"].reverse()
    for candidate in payload["courses"]:
        candidate["section_bundles"].reverse()
    reordered = run(payload)

    def summary(response):
        return [(r.rank, r.score, r.status, sorted(bundle_ids(r)), r.metrics) for r in response.results]

    assert summary(reordered) == summary(original)
    assert reordered.diagnostics.explored_combinations == original.diagnostics.explored_combinations


def test_same_request_twice_gives_identical_responses():
    assert run(_tangled_request()).model_dump_json() == run(_tangled_request()).model_dump_json()
