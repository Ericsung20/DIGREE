"""Hard constraints, metrics and diagnostics, exercised on the pure engine."""

import pytest

from tests.builders import bundle, bundle_ids, course, edge, load_fixture_request, meeting, request, run

# --------------------------------------------------------------------------
# Time window, blocked days, overlap
# --------------------------------------------------------------------------


def test_t02_meeting_before_earliest_start_is_rejected():
    payload = request(
        [
            course(
                "x",
                [
                    bundle("x-early", [meeting("MON", 540, 590)]),
                    bundle("x-ok", [meeting("MON", 600, 650)]),
                ],
            )
        ],
        earliest_start_min=600,
    )
    response = run(payload)
    assert [bundle_ids(r) for r in response.results] == [["x-ok"]]
    assert response.diagnostics.explored_combinations == 2
    assert response.diagnostics.rejected_by_reason == {"outside_time_window": 1}


def test_meeting_after_latest_end_is_rejected():
    payload = request(
        [course("x", [bundle("x-late", [meeting("MON", 1030, 1100)])])], latest_end_min=1080
    )
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"outside_time_window": 1}
    assert response.diagnostics.no_results_reasons == ["outside_time_window"]


def test_meeting_exactly_on_the_window_edges_is_allowed():
    payload = request(
        [course("x", [bundle("x-A", [meeting("MON", 600, 1080)])])],
        earliest_start_min=600,
        latest_end_min=1080,
    )
    assert len(run(payload).results) == 1


def test_blocked_day_is_rejected():
    payload = request(
        [
            course(
                "x",
                [
                    bundle("x-fri", [meeting("MON", 600, 650), meeting("FRI", 600, 650)]),
                    bundle("x-mon", [meeting("MON", 600, 650)]),
                ],
            )
        ],
        blocked_days=["FRI"],
    )
    response = run(payload)
    assert [bundle_ids(r) for r in response.results] == [["x-mon"]]
    assert response.diagnostics.rejected_by_reason == {"blocked_day": 1}


@pytest.mark.parametrize("other_start, other_end", [(660, 710), (700, 750), (670, 690), (640, 730)])
def test_t03_same_day_overlap_is_rejected(other_start, other_end):
    payload = request(
        [
            course("x", [bundle("x-A", [meeting("MON", 660, 710)])]),
            course("y", [bundle("y-A", [meeting("MON", other_start, other_end)])]),
        ]
    )
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.explored_combinations == 1
    assert response.diagnostics.rejected_by_reason == {"time_overlap": 1}
    assert response.diagnostics.no_results_reasons == ["time_overlap"]


def test_intervals_are_half_open():
    """Ending at 10:50 and starting at 10:50 is not an overlap."""
    payload = request(
        [
            course("x", [bundle("x-A", [meeting("MON", 600, 650)])]),
            course("y", [bundle("y-A", [meeting("MON", 650, 700)])]),
        ]
    )
    response = run(payload)
    assert len(response.results) == 1
    assert response.results[0].metrics.idle_gap_minutes_weekly == 0


def test_t06_same_time_on_different_days_is_not_an_overlap():
    payload = request(
        [
            course("x", [bundle("x-A", [meeting("MON", 660, 710)])]),
            course("y", [bundle("y-A", [meeting("TUE", 660, 710)])]),
        ]
    )
    response = run(payload)
    assert len(response.results) == 1
    assert response.diagnostics.rejected_by_reason == {}


def test_t13_every_meeting_of_a_bundle_is_checked():
    lecture_and_lab = bundle("x-A", [meeting("MON", 600, 650), meeting("WED", 660, 710)])
    payload = request(
        [
            course("x", [lecture_and_lab]),
            course(
                "y",
                [
                    bundle("y-hits-lab", [meeting("WED", 680, 730)]),
                    bundle("y-clear", [meeting("WED", 720, 770)]),
                ],
            ),
        ]
    )
    response = run(payload)
    assert [bundle_ids(r) for r in response.results] == [["x-A", "y-clear"]]
    assert response.diagnostics.rejected_by_reason == {"time_overlap": 1}


def test_bundle_whose_own_meetings_overlap_is_rejected():
    payload = request(
        [course("x", [bundle("x-A", [meeting("MON", 600, 650), meeting("MON", 630, 680)])])]
    )
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"time_overlap": 1}


def test_t12_asynchronous_bundle_counts_credits_but_no_time():
    payload = request(
        [
            course("online", [bundle("online-A", [])], credits=(3,)),
            course("x", [bundle("x-A", [meeting("MON", 600, 650)])], credits=(4,)),
        ]
    )
    result = run(payload).results[0]
    assert bundle_ids(result) == ["online-A", "x-A"]
    assert result.selected[0].meetings == []
    assert result.metrics.model_dump() == {
        "total_credits": 7,
        "walking_minutes_weekly": 0,
        "idle_gap_minutes_weekly": 0,
        "campus_days": 1,
    }


# --------------------------------------------------------------------------
# Walking feasibility
# --------------------------------------------------------------------------


def _two_classes(gap: int, building: str = "BETA") -> list[dict]:
    return [
        course("x", [bundle("x-A", [meeting("MON", 600, 650, "ALPHA")])]),
        course("y", [bundle("y-A", [meeting("MON", 650 + gap, 700 + gap, building)])]),
    ]


def test_t04_gap_10_walk_6_buffer_3_is_allowed():
    payload = request(_two_classes(gap=10), [edge("ALPHA", "BETA", 6)], walking_buffer_min=3)
    result = run(payload).results[0]
    assert result.metrics.walking_minutes_weekly == 6
    assert result.metrics.idle_gap_minutes_weekly == 4


def test_t05_gap_10_walk_12_buffer_3_is_rejected():
    payload = request(_two_classes(gap=10), [edge("ALPHA", "BETA", 12)], walking_buffer_min=3)
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"insufficient_walk_time": 1}
    assert response.diagnostics.no_results_reasons == ["insufficient_walk_time"]


@pytest.mark.parametrize("walk, feasible", [(7, True), (8, False)])
def test_gap_equal_to_walk_plus_buffer_is_allowed(walk, feasible):
    payload = request(_two_classes(gap=10), [edge("ALPHA", "BETA", walk)], walking_buffer_min=3)
    assert bool(run(payload).results) is feasible


def test_buffer_applies_inside_one_building_too():
    """gap >= walk + buffer is applied literally: 0 >= 0 + 3 fails."""
    payload = request(_two_classes(gap=0, building="ALPHA"), walking_buffer_min=3)
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"insufficient_walk_time": 1}


@pytest.mark.parametrize("limit, feasible", [(None, True), (18, True), (17, False)])
def test_h7_walk_longer_than_the_per_transition_maximum_is_rejected(limit, feasible):
    payload = request(
        _two_classes(gap=70),
        [edge("ALPHA", "BETA", 18)],
        walking_buffer_min=3,
        max_walk_per_transition_min=limit,
    )
    response = run(payload)
    assert bool(response.results) is feasible
    if not feasible:
        assert response.diagnostics.rejected_by_reason == {"walk_exceeds_max": 1}


def test_too_little_time_is_reported_before_too_long_a_walk():
    payload = request(
        _two_classes(gap=10),
        [edge("ALPHA", "BETA", 25)],
        walking_buffer_min=3,
        max_walk_per_transition_min=20,
    )
    assert run(payload).diagnostics.rejected_by_reason == {"insufficient_walk_time": 1}


def test_one_way_edge_is_not_used_in_reverse():
    courses = _two_classes(gap=30)

    forward = run(request(courses, [edge("ALPHA", "BETA", 6, bidirectional=False)])).results[0]
    assert forward.status == "ready"
    assert forward.metrics.walking_minutes_weekly == 6

    reverse = run(request(courses, [edge("BETA", "ALPHA", 6, bidirectional=False)])).results[0]
    assert reverse.status == "needs_review"
    assert reverse.metrics.walking_minutes_weekly == 0
    assert [w.split(": ")[0] for w in reverse.warnings] == ["walking_time_unknown"]
    assert "from ALPHA to BETA" in reverse.warnings[0]


def test_missing_edge_is_never_treated_as_zero_minutes():
    """T11: a zero-minute walk would be a ready schedule scoring 100."""
    result = run(request(_two_classes(gap=30))).results[0]
    assert result.status == "needs_review"
    assert result.score == 50.0
    assert result.warnings == [
        "walking_time_unknown: No walking time from ALPHA to BETA; "
        "that transition was not checked and is not in the walking total."
    ]


def test_missing_edge_does_not_matter_when_a_known_transition_already_fails():
    courses = _two_classes(gap=10) + [
        course("z", [bundle("z-A", [meeting("MON", 800, 850, "GAMMA")])])
    ]
    response = run(request(courses, [edge("ALPHA", "BETA", 12)], walking_buffer_min=3))
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"insufficient_walk_time": 1}


# --------------------------------------------------------------------------
# Credits
# --------------------------------------------------------------------------


def _three_courses(credits: int) -> list[dict]:
    return [
        course(name, [bundle(f"{name}-A", [meeting(day, 600, 650)])], credits=(credits,))
        for name, day in (("x", "MON"), ("y", "TUE"), ("z", "WED"))
    ]


def test_t07_required_credits_above_maximum_returns_no_results_with_reason():
    response = run(request(_three_courses(4), max_credits=10))
    assert response.results == []
    assert response.diagnostics.explored_combinations == 1
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 1}
    assert response.diagnostics.no_results_reasons == ["credits_out_of_range"]


def test_required_credits_below_minimum_with_no_optional_courses_returns_no_results():
    response = run(request(_three_courses(3), min_credits=12))
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 1}


def test_t17_variable_credit_course_picks_the_option_that_fits_the_range():
    payload = request(
        [
            course("var", [bundle("var-A", [meeting("MON", 600, 650)])], credits=(1, 2, 3)),
            course("fix", [bundle("fix-A", [meeting("TUE", 600, 650)])], credits=(3,)),
        ],
        min_credits=5,
        max_credits=5,
    )
    response = run(payload)
    assert len(response.results) == 1
    assert [(s.course_id, s.credits) for s in response.results[0].selected] == [("var", 2), ("fix", 3)]
    assert response.results[0].metrics.total_credits == 5
    assert response.diagnostics.explored_combinations == 3
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 2}


def test_every_credit_option_inside_the_range_is_a_separate_schedule():
    payload = request(
        [course("var", [bundle("var-A", [meeting("MON", 600, 650)])], credits=(3, 1, 2, 2))],
        min_credits=2,
        max_credits=3,
    )
    response = run(payload)
    assert [r.selected[0].credits for r in response.results] == [2, 3]
    assert response.diagnostics.explored_combinations == 3


def test_credit_range_that_no_combination_of_options_hits_exactly():
    payload = request(
        [
            course("var", [bundle("var-A", [meeting("MON", 600, 650)])], credits=(1, 5)),
            course("fix", [bundle("fix-A", [meeting("TUE", 600, 650)])], credits=(3,)),
        ],
        min_credits=6,
        max_credits=7,
    )
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.explored_combinations == 2
    assert response.diagnostics.rejected_by_reason == {"credits_out_of_range": 2}


def test_required_course_with_no_bundles_is_explained():
    payload = request(
        [
            course("x", [bundle("x-A", [meeting("MON", 600, 650)])]),
            course("empty", []),
        ]
    )
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.explored_combinations == 0
    assert response.diagnostics.no_results_reasons == ["required_course_without_bundles"]


# --------------------------------------------------------------------------
# Metrics and diagnostics
# --------------------------------------------------------------------------


def test_weekly_metrics_sum_every_same_day_transition():
    payload = request(
        [
            course("x", [bundle("x-A", [meeting("MON", 600, 650, "ALPHA"), meeting("WED", 600, 650, "ALPHA")])]),
            course("y", [bundle("y-A", [meeting("MON", 700, 750, "BETA")])]),
            course("z", [bundle("z-A", [meeting("MON", 900, 950, "ALPHA")])]),
        ],
        [edge("ALPHA", "BETA", 10)],
    )
    metrics = run(payload).results[0].metrics
    assert metrics.walking_minutes_weekly == 20  # ALPHA -> BETA -> ALPHA on Monday
    assert metrics.idle_gap_minutes_weekly == (50 - 10) + (150 - 10)
    assert metrics.campus_days == 2
    assert metrics.total_credits == 9


def test_pruned_selection_counts_every_combination_beneath_it():
    """A second STAT 240 bundle doubles the fixture: 8 combinations, 2 overlapping."""
    payload = load_fixture_request()
    payload["top_k"] = 5
    payload["courses"][2]["section_bundles"].append(
        bundle("stat240-B", [meeting("FRI", 600, 675, "DELTA")])
    )
    response = run(payload)
    assert response.diagnostics.explored_combinations == 8
    assert response.diagnostics.rejected_by_reason == {"time_overlap": 2}
    assert len(response.results) == 5


def test_rejection_reasons_are_reported_in_check_order():
    payload = request(
        [
            course(
                "x",
                [
                    bundle("x-overlap", [meeting("MON", 600, 650)]),
                    bundle("x-early", [meeting("TUE", 300, 350)]),
                    bundle("x-blocked", [meeting("FRI", 600, 650)]),
                ],
            ),
            course("y", [bundle("y-A", [meeting("MON", 600, 650)])]),
        ],
        earliest_start_min=480,
        blocked_days=["FRI"],
    )
    diagnostics = run(payload).diagnostics
    assert diagnostics.explored_combinations == 3
    assert list(diagnostics.rejected_by_reason.items()) == [
        ("outside_time_window", 1),
        ("blocked_day", 1),
        ("time_overlap", 1),
    ]
    assert diagnostics.no_results_reasons == ["outside_time_window", "blocked_day", "time_overlap"]
    assert diagnostics.search_truncated is False


# --------------------------------------------------------------------------
# H8: required courses that cannot be taken
# --------------------------------------------------------------------------


def _one_class(course_id: str = "x", day: str = "MON", **overrides) -> dict:
    return course(course_id, [bundle(f"{course_id}-A", [meeting(day, 600, 650)])], **overrides)


def test_h8_ineligible_required_course_returns_no_results_without_searching():
    response = run(request([_one_class("x"), _one_class("y", "TUE", eligibility_status="ineligible")]))
    assert response.results == []
    assert response.diagnostics.explored_combinations == 0
    assert response.diagnostics.rejected_by_reason == {}
    assert response.diagnostics.no_results_reasons == ["required_course_ineligible"]


def test_h8_completed_required_course_that_is_not_repeatable_returns_no_results():
    response = run(request([_one_class("x", already_completed=True, repeatable=False)]))
    assert response.results == []
    assert response.diagnostics.explored_combinations == 0
    assert response.diagnostics.no_results_reasons == ["required_course_already_completed"]


def test_h8_completed_required_course_that_is_repeatable_is_scheduled():
    response = run(request([_one_class("x", already_completed=True, repeatable=True)]))
    assert [r.status for r in response.results] == ["ready"]
    assert response.results[0].warnings == []


def test_h8_blocking_reasons_are_listed_once_each_in_a_fixed_order():
    payload = request(
        [
            course("empty", []),
            _one_class("done", already_completed=True),
            _one_class("blocked", "TUE", eligibility_status="ineligible"),
            _one_class("also-blocked", "WED", eligibility_status="ineligible"),
        ]
    )
    assert run(payload).diagnostics.no_results_reasons == [
        "required_course_ineligible",
        "required_course_already_completed",
        "required_course_without_bundles",
    ]


def test_h8_ineligible_optional_course_does_not_block_required_schedules():
    payload = request(
        [_one_class("x"), _one_class("opt", "TUE", is_required=False, eligibility_status="ineligible")]
    )
    response = run(payload)
    assert [bundle_ids(r) for r in response.results] == [["x-A"]]
    assert response.results[0].status == "ready"


# --------------------------------------------------------------------------
# H10: full sections
# --------------------------------------------------------------------------


def _open_and_full() -> list[dict]:
    return [
        course(
            "x",
            [
                bundle("x-full", [meeting("MON", 600, 650)], seat_status="full"),
                bundle("x-open", [meeting("TUE", 600, 650)]),
            ],
        )
    ]


def test_h10_full_bundle_is_rejected_when_exclusion_is_on():
    response = run(request(_open_and_full(), exclude_full_sections=True))
    assert [bundle_ids(r) for r in response.results] == [["x-open"]]
    assert response.results[0].status == "ready"
    assert response.diagnostics.explored_combinations == 2
    assert response.diagnostics.rejected_by_reason == {"section_full": 1}


def test_h10_every_bundle_full_returns_no_results_with_the_reason():
    payload = request(
        [course("x", [bundle("x-A", [meeting("MON", 600, 650)], seat_status="full")])],
        exclude_full_sections=True,
    )
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"section_full": 1}
    assert response.diagnostics.no_results_reasons == ["section_full"]


def test_h10_unknown_seat_status_is_not_treated_as_full():
    payload = request(
        [course("x", [bundle("x-A", [meeting("MON", 600, 650)], seat_status="unknown")])],
        exclude_full_sections=True,
    )
    response = run(payload)
    assert [r.status for r in response.results] == ["needs_review"]
    assert response.diagnostics.rejected_by_reason == {}


def test_full_bundle_is_kept_when_exclusion_is_off():
    response = run(request(_open_and_full()))
    assert sorted(bundle_ids(r)[0] for r in response.results) == ["x-full", "x-open"]
    assert response.diagnostics.rejected_by_reason == {}


def test_section_full_is_checked_before_the_time_checks():
    payload = request(
        [
            course(
                "x",
                [
                    bundle("x-full-early", [meeting("MON", 300, 350)], seat_status="full"),
                    bundle("x-early", [meeting("MON", 300, 350)]),
                    bundle("x-overlap", [meeting("TUE", 600, 650)]),
                ],
            ),
            _one_class("y", "TUE"),
        ],
        earliest_start_min=480,
        exclude_full_sections=True,
    )
    diagnostics = run(payload).diagnostics
    assert diagnostics.explored_combinations == 3
    assert list(diagnostics.rejected_by_reason.items()) == [
        ("section_full", 1),
        ("outside_time_window", 1),
        ("time_overlap", 1),
    ]
    assert diagnostics.no_results_reasons == ["section_full", "outside_time_window", "time_overlap"]
