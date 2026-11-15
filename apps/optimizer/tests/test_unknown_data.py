"""Unknown data: review status, warnings, and what the metrics and wording say."""

import re

import pytest

from app import messages
from tests.builders import bundle, bundle_ids, course, edge, meeting, request, run


def codes(result) -> list[str]:
    return [warning.split(": ")[0] for warning in result.warnings]


def online(day: str, start: int, end: int, building: str | None = None) -> dict:
    return meeting(day, start, end, building, mode="online_sync")


def one_meeting_course(course_id: str, the_meeting: dict, **overrides) -> dict:
    return course(course_id, [bundle(f"{course_id}-A", [the_meeting])], **overrides)


COMPLETE_TRAVEL_REASONS = [
    "Class times do not overlap and every between-class walk was checked; "
    "weekly between-class walking: 0 min.",
    "Review the warnings before enrolling.",
]


def incomplete_travel_reasons(known_walking: int) -> list[str]:
    return [
        "Class times do not overlap, but travel between some classes could not be checked.",
        "Walking and idle-gap figures count known transitions only; "
        f"known weekly between-class walking: {known_walking} min.",
        "Review the warnings before enrolling.",
    ]


# --------------------------------------------------------------------------
# Eligibility and seats
# --------------------------------------------------------------------------


def test_t10_required_course_with_unknown_eligibility_needs_review():
    payload = request(
        [one_meeting_course("x", meeting("MON", 600, 650), eligibility_status="unknown")]
    )
    result = run(payload).results[0]
    assert result.status == "needs_review"
    assert result.warnings == [
        "eligibility_unknown: Eligibility for X has not been confirmed; "
        "check its requisites before enrolling."
    ]
    assert result.score == 100.0
    assert result.reasons == COMPLETE_TRAVEL_REASONS


def test_unknown_seat_status_needs_review_whether_or_not_full_sections_are_excluded():
    for exclude in (False, True):
        payload = request(
            [course("x", [bundle("x-A", [meeting("MON", 600, 650)], seat_status="unknown")])],
            exclude_full_sections=exclude,
        )
        result = run(payload).results[0]
        assert result.status == "needs_review"
        assert result.warnings == [
            "seat_status_unknown: Seat availability for X (x-A) is unknown."
        ]


def test_included_full_section_is_never_presented_as_ready():
    payload = request(
        [course("x", [bundle("x-A", [meeting("MON", 600, 650)], seat_status="full")])]
    )
    result = run(payload).results[0]
    assert result.status == "needs_review"
    assert result.warnings == [
        "section_full_included: X (x-A) is reported as full; enrolling in it may not be possible."
    ]
    assert result.reasons == COMPLETE_TRAVEL_REASONS


def test_ready_schedule_ranks_above_a_higher_scoring_one_that_needs_review():
    payload = request(
        [
            course(
                "x",
                [
                    bundle("x-near-full", [meeting("MON", 600, 650, "ALPHA")], seat_status="full"),
                    bundle("x-far-open", [meeting("MON", 600, 650, "BETA")]),
                ],
            ),
            one_meeting_course("y", meeting("MON", 700, 750, "ALPHA")),
        ],
        [edge("ALPHA", "BETA", 20)],
    )
    results = run(payload).results
    assert [(bundle_ids(r)[0], r.status, r.score) for r in results] == [
        ("x-far-open", "ready", 51.34),
        ("x-near-full", "needs_review", 100.0),
    ]


# --------------------------------------------------------------------------
# Missing walking times
# --------------------------------------------------------------------------


def _three_in_a_row(edges: list[dict], **constraints) -> dict:
    """ALPHA 10:00, BETA 11:40, GAMMA 13:20 on Monday, 50 minutes between classes."""
    return request(
        [
            one_meeting_course("x", meeting("MON", 600, 650, "ALPHA")),
            one_meeting_course("y", meeting("MON", 700, 750, "BETA")),
            one_meeting_course("z", meeting("MON", 800, 850, "GAMMA")),
        ],
        edges,
        **constraints,
    )


def test_metrics_are_subtotals_over_the_known_transitions():
    result = run(_three_in_a_row([edge("ALPHA", "BETA", 10)])).results[0]
    assert result.status == "needs_review"
    assert result.metrics.walking_minutes_weekly == 10  # ALPHA -> BETA only
    assert result.metrics.idle_gap_minutes_weekly == 40  # 50 - 10, BETA -> GAMMA left out
    assert result.warnings == [
        "walking_time_unknown: No walking time from BETA to GAMMA; "
        "that transition was not checked and is not in the walking total."
    ]
    assert result.reasons == incomplete_travel_reasons(known_walking=10)


def test_gap_shorter_than_the_buffer_is_rejected_even_when_the_walk_is_unknown():
    """No walk takes less than 0 minutes, so this is impossible whatever the distance."""
    payload = request(
        [
            one_meeting_course("x", meeting("MON", 600, 650, "ALPHA")),
            one_meeting_course("y", meeting("MON", 652, 700, "BETA")),
        ],
        walking_buffer_min=3,
    )
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"insufficient_walk_time": 1}


def test_known_transition_that_fails_still_rejects_a_schedule_with_unknown_ones():
    response = run(_three_in_a_row([edge("ALPHA", "BETA", 60)]))
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {"insufficient_walk_time": 1}


def test_walk_maximum_cannot_reject_an_unknown_walk():
    response = run(_three_in_a_row([edge("ALPHA", "BETA", 10)], max_walk_per_transition_min=15))
    assert [r.status for r in response.results] == ["needs_review"]
    assert response.diagnostics.rejected_by_reason == {}


def test_each_missing_pair_is_reported_once_in_sorted_order():
    payload = request(
        [
            course("x", [bundle("x-A", [meeting("MON", 600, 650, "BETA"), meeting("WED", 600, 650, "BETA")])]),
            course("y", [bundle("y-A", [meeting("MON", 700, 750, "ALPHA"), meeting("WED", 700, 750, "ALPHA")])]),
            one_meeting_course("z", meeting("MON", 800, 850, "BETA")),
        ]
    )
    result = run(payload).results[0]
    assert [w.split(";")[0] for w in result.warnings] == [
        "walking_time_unknown: No walking time from ALPHA to BETA",
        "walking_time_unknown: No walking time from BETA to ALPHA",
    ]


# --------------------------------------------------------------------------
# Buildings and meeting modes
# --------------------------------------------------------------------------


def test_meeting_without_a_building_needs_review_even_with_no_neighbours():
    result = run(request([one_meeting_course("x", meeting("MON", 600, 650, None))])).results[0]
    assert result.status == "needs_review"
    assert result.warnings == [
        "building_unknown: X (x-A) has a meeting with no building; "
        "walking to or from it cannot be checked."
    ]
    assert result.metrics.campus_days == 1
    assert result.reasons == COMPLETE_TRAVEL_REASONS


def test_two_unknown_buildings_are_not_assumed_to_be_the_same_building():
    payload = request(
        [
            one_meeting_course("x", meeting("MON", 600, 650, None)),
            one_meeting_course("y", meeting("MON", 700, 750, None)),
        ]
    )
    result = run(payload).results[0]
    assert codes(result) == ["building_unknown", "building_unknown"]
    assert result.metrics.walking_minutes_weekly == 0
    assert result.metrics.idle_gap_minutes_weekly == 0
    assert result.score == 50.0  # not the 100 a zero-minute walk would earn
    assert result.reasons == incomplete_travel_reasons(known_walking=0)


def test_unknown_building_too_close_to_the_next_class_is_rejected():
    payload = request(
        [
            one_meeting_course("x", meeting("MON", 600, 650, None)),
            one_meeting_course("y", meeting("MON", 651, 700, "ALPHA")),
        ],
        walking_buffer_min=3,
    )
    assert run(payload).diagnostics.rejected_by_reason == {"insufficient_walk_time": 1}


@pytest.mark.parametrize("walk, feasible", [(6, True), (12, False)])
def test_hybrid_meeting_with_a_building_is_treated_as_in_person(walk, feasible):
    payload = request(
        [
            one_meeting_course("x", meeting("MON", 600, 650, "ALPHA", mode="hybrid")),
            one_meeting_course("y", meeting("MON", 660, 710, "BETA")),
        ],
        [edge("ALPHA", "BETA", walk)],
        walking_buffer_min=3,
    )
    response = run(payload)
    if not feasible:
        assert response.diagnostics.rejected_by_reason == {"insufficient_walk_time": 1}
        return
    result = response.results[0]
    assert result.status == "ready"
    assert result.metrics.walking_minutes_weekly == 6
    assert result.metrics.campus_days == 1
    assert result.selected[0].meetings[0].mode == "hybrid"


def test_hybrid_meeting_without_a_building_needs_review():
    payload = request([one_meeting_course("x", meeting("MON", 600, 650, None, mode="hybrid"))])
    assert codes(run(payload).results[0]) == ["building_unknown"]


def test_online_meeting_next_to_an_in_person_one_needs_review():
    payload = request(
        [
            one_meeting_course("web", online("MON", 600, 650)),
            one_meeting_course("y", meeting("MON", 650, 700, "ALPHA")),
        ],
        walking_buffer_min=3,
    )
    result = run(payload).results[0]
    assert result.status == "needs_review"
    assert result.warnings == [
        "location_uncertain: WEB (web-A) meets online directly before or after an in-person "
        "class; travel between them was not checked."
    ]
    assert result.metrics.walking_minutes_weekly == 0
    assert result.metrics.idle_gap_minutes_weekly == 0
    assert result.metrics.campus_days == 1
    assert result.reasons == incomplete_travel_reasons(known_walking=0)


def test_building_on_an_online_meeting_is_not_used_for_walking():
    payload = request(
        [
            one_meeting_course("web", online("MON", 600, 650, building="ALPHA")),
            one_meeting_course("y", meeting("MON", 700, 750, "BETA")),
        ],
        [edge("ALPHA", "BETA", 10)],
    )
    result = run(payload).results[0]
    assert codes(result) == ["location_uncertain"]
    assert result.metrics.walking_minutes_weekly == 0


def test_online_meeting_between_two_in_person_ones_is_reported_once():
    payload = request(
        [
            one_meeting_course("x", meeting("MON", 600, 650, "ALPHA")),
            one_meeting_course("web", online("MON", 660, 710)),
            one_meeting_course("z", meeting("MON", 720, 770, "BETA")),
        ],
        [edge("ALPHA", "BETA", 10)],
    )
    result = run(payload).results[0]
    assert codes(result) == ["location_uncertain"]
    assert result.metrics.walking_minutes_weekly == 0
    assert result.metrics.idle_gap_minutes_weekly == 0


@pytest.mark.parametrize("gap", [0, 30])
def test_back_to_back_online_meetings_need_no_travel(gap):
    payload = request(
        [
            one_meeting_course("web1", online("MON", 600, 650)),
            one_meeting_course("web2", online("MON", 650 + gap, 700 + gap)),
        ],
        walking_buffer_min=3,
    )
    result = run(payload).results[0]
    assert result.status == "ready"
    assert result.warnings == []
    assert result.metrics.walking_minutes_weekly == 0
    assert result.metrics.idle_gap_minutes_weekly == gap
    assert result.metrics.campus_days == 0


def test_online_only_day_is_not_a_campus_day():
    payload = request(
        [
            one_meeting_course("web", online("TUE", 600, 650)),
            one_meeting_course("y", meeting("MON", 600, 650, "ALPHA")),
        ]
    )
    result = run(payload).results[0]
    assert result.status == "ready"
    assert result.metrics.campus_days == 1


@pytest.mark.parametrize(
    "constraints, reason",
    [
        ({}, "time_overlap"),
        ({"blocked_days": ["MON"]}, "blocked_day"),
        ({"earliest_start_min": 630}, "outside_time_window"),
    ],
)
def test_online_meetings_still_obey_the_time_constraints(constraints, reason):
    payload = request(
        [
            one_meeting_course("web", online("MON", 600, 650)),
            one_meeting_course("y", meeting("MON", 630, 680, "ALPHA")),
        ],
        **constraints,
    )
    response = run(payload)
    assert response.results == []
    assert response.diagnostics.rejected_by_reason == {reason: 1}


# --------------------------------------------------------------------------
# Warning format, order and wording
# --------------------------------------------------------------------------


def _every_warning_at_once() -> dict:
    return request(
        [
            course(
                "a",
                [bundle("a-A", [meeting("MON", 600, 650, "ALPHA")], seat_status="unknown")],
                eligibility_status="unknown",
            ),
            course(
                "b",
                [bundle("b-A", [meeting("MON", 700, 750, "BETA")], seat_status="full")],
                eligibility_status="unknown",
            ),
            one_meeting_course("c", meeting("MON", 800, 850, None)),
            one_meeting_course("d", online("MON", 900, 950)),
        ]
    )


def test_warnings_follow_code_order_then_request_order():
    result = run(_every_warning_at_once()).results[0]
    assert [w.split(";")[0].split(" is ")[0].split(" has ")[0] for w in result.warnings] == [
        "eligibility_unknown: Eligibility for A",
        "eligibility_unknown: Eligibility for B",
        "seat_status_unknown: Seat availability for A (a-A)",
        "section_full_included: B (b-A)",
        "building_unknown: C (c-A)",
        "walking_time_unknown: No walking time from ALPHA to BETA",
        "location_uncertain: D (d-A) meets online directly before or after an in-person class",
    ]
    assert codes(result) == sorted(codes(result), key=messages.WARNING_CODES.index)
    assert result.status == "needs_review"


def test_every_warning_is_a_known_code_followed_by_a_sentence():
    result = run(_every_warning_at_once()).results[0]
    assert set(codes(result)) == set(messages.WARNING_CODES)
    for warning in result.warnings:
        assert re.fullmatch(r"[a-z_]+: [A-Z].*\.", warning), warning


def test_no_text_claims_verification_or_a_guarantee():
    complete = run(request([one_meeting_course("x", meeting("MON", 600, 650), eligibility_status="unknown")]))
    texts = [
        text
        for response in (run(_every_warning_at_once()), complete)
        for result in response.results
        for text in result.warnings + result.reasons
    ]
    assert texts
    for text in texts:
        assert not re.search(r"verif|guarant|official|approved|certif", text.lower()), text


def test_review_wording_does_not_reuse_the_ready_sentence():
    result = run(_every_warning_at_once()).results[0]
    assert not any("All selected courses fit" in reason for reason in result.reasons)
    assert result.reasons == incomplete_travel_reasons(known_walking=0)


def test_status_follows_review_warnings_only():
    assert messages.status_for([]) == "ready"
    assert messages.status_for(["seat_status_unknown: Seat availability is unknown."]) == "needs_review"
    # A later advisory warning must not force a review on its own.
    assert messages.status_for(["some_advisory_note: Nothing to act on."]) == "ready"
    assert (
        messages.status_for(["some_advisory_note: Nothing.", "building_unknown: No building."])
        == "needs_review"
    )


def test_review_results_are_reproducible():
    first = run(_every_warning_at_once()).model_dump_json()
    second = run(_every_warning_at_once()).model_dump_json()
    assert first == second
