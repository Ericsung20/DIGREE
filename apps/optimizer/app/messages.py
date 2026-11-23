"""Stable codes and wording the API emits: rejections, warnings, explanations.

Clients may branch on the codes, so they must not change without team
agreement. No text here may claim that the university has verified, approved
or guaranteed anything.
"""

# Keys of diagnostics.rejected_by_reason, in the order the checks run.
# Each rejected combination is counted once, under the first check it fails.
REJECTION_REASONS = (
    "credits_out_of_range",
    "max_major_courses_exceeded",
    "min_major_courses_unmet",
    "section_full",
    "outside_time_window",
    "blocked_day",
    "time_overlap",
    "insufficient_walk_time",
    "walk_exceeds_max",
)

# diagnostics.no_results_reasons lists SEARCH_TRUNCATED first when it applies,
# then these in this order, then the rejection reasons that occurred.
REQUIRED_COURSE_INELIGIBLE = "required_course_ineligible"
REQUIRED_COURSE_ALREADY_COMPLETED = "required_course_already_completed"
REQUIRED_COURSE_WITHOUT_BUNDLES = "required_course_without_bundles"
NO_USABLE_OPTIONAL_COURSES = "no_usable_optional_courses"
# Listed first when the search stopped early: an empty result then means
# "none found so far", not "none exists".
SEARCH_TRUNCATED = "search_truncated"

# Every warning is the string "<code>: <message>". A result lists its review
# warnings first, then its advisory ones, each group in the order given here.

# Open questions about feasibility. Any one of these makes a result needs_review.
REVIEW_WARNING_CODES = (
    "eligibility_unknown",
    "seat_status_unknown",
    "section_full_included",
    "building_unknown",
    "walking_time_unknown",
    "location_uncertain",
)

# Notes about how the result was scored or found. They never change the status.
ADVISORY_WARNING_CODES = (
    "grade_data_missing",
    "degree_fit_data_missing",
    "breadth_data_missing",
    "instructor_data_missing",
    "score_not_comparable",
    "search_incomplete",
)

WARNING_CODES = REVIEW_WARNING_CODES + ADVISORY_WARNING_CODES

READY = "ready"
NEEDS_REVIEW = "needs_review"


def warning_code(warning: str) -> str:
    return warning.split(": ", 1)[0]


def status_for(warnings: list[str]) -> str:
    if any(warning_code(warning) in REVIEW_WARNING_CODES for warning in warnings):
        return NEEDS_REVIEW
    return READY


def eligibility_unknown(course_code: str) -> str:
    return (
        f"eligibility_unknown: Eligibility for {course_code} has not been confirmed; "
        "check its requisites before enrolling."
    )


def seat_status_unknown(course_code: str, bundle_id: str) -> str:
    return f"seat_status_unknown: Seat availability for {course_code} ({bundle_id}) is unknown."


def section_full_included(course_code: str, bundle_id: str) -> str:
    return (
        f"section_full_included: {course_code} ({bundle_id}) is reported as full; "
        "enrolling in it may not be possible."
    )


def building_unknown(course_code: str, bundle_id: str) -> str:
    return (
        f"building_unknown: {course_code} ({bundle_id}) has a meeting with no building; "
        "walking to or from it cannot be checked."
    )


def walking_time_unknown(origin: str, destination: str) -> str:
    return (
        f"walking_time_unknown: No walking time from {origin} to {destination}; "
        "that transition was not checked and is not in the walking total."
    )


def location_uncertain(course_code: str, bundle_id: str) -> str:
    return (
        f"location_uncertain: {course_code} ({bundle_id}) meets online directly before or after "
        "an in-person class; travel between them was not checked."
    )


def grade_data_missing(course_codes: list[str]) -> str:
    return (
        f"grade_data_missing: No grade statistics for {', '.join(course_codes)}; "
        "a neutral value was used for the grade preference."
    )


def grade_data_unavailable() -> str:
    return (
        "grade_data_missing: No grade statistics were provided for the optional courses; "
        "the grade preference did not affect the score."
    )


def degree_fit_data_missing(course_codes: list[str]) -> str:
    return (
        f"degree_fit_data_missing: No degree-fit value for {', '.join(course_codes)}; "
        "a neutral value was used for the degree-fit preference."
    )


def degree_fit_data_unavailable() -> str:
    return (
        "degree_fit_data_missing: No degree-fit values were provided for the optional courses; "
        "the degree-fit preference did not affect the score."
    )


def breadth_data_missing(course_codes: list[str]) -> str:
    return (
        f"breadth_data_missing: No breadth codes for {', '.join(course_codes)}; "
        "a neutral value was used for the breadth preference."
    )


def breadth_data_unavailable() -> str:
    return (
        "breadth_data_missing: No breadth codes were provided for the optional courses; "
        "the breadth preference did not affect the score."
    )


def instructor_data_missing(sections: list[str]) -> str:
    return (
        f"instructor_data_missing: No instructor rating for {', '.join(sections)}; "
        "a neutral value was used for the instructor preference."
    )


def instructor_data_unavailable() -> str:
    return (
        "instructor_data_missing: No instructor ratings were provided; "
        "the instructor preference did not affect the score."
    )


def score_not_comparable() -> str:
    return (
        "score_not_comparable: None of the weighted preferences can tell these schedules apart; "
        "every score is a neutral 50 and the order follows course and section IDs."
    )


def search_incomplete() -> str:
    return (
        "search_incomplete: The search stopped before examining every combination; "
        "better schedules may exist."
    )


def in_listed_order(advisories: dict[str, str]) -> list[str]:
    """Advisory warnings keyed by code, in ADVISORY_WARNING_CODES order."""
    return [advisories[code] for code in ADVISORY_WARNING_CODES if code in advisories]


def explain(
    status: str,
    travel_complete: bool,
    walking_minutes_weekly: int,
    optional_course_codes: list[str] | None = None,
) -> list[str]:
    """The `reasons` of a result. The ready sentence is fixed by the shared fixture."""
    added = (
        [f"Optional courses selected: {', '.join(optional_course_codes)}."]
        if optional_course_codes
        else []
    )
    if status == READY:
        return [
            "All selected courses fit; weekly between-class walking: "
            f"{walking_minutes_weekly} min.",
            *added,
        ]
    if travel_complete:
        return [
            "Class times do not overlap and every between-class walk was checked; "
            f"weekly between-class walking: {walking_minutes_weekly} min.",
            *added,
            "Review the warnings before enrolling.",
        ]
    return [
        "Class times do not overlap, but travel between some classes could not be checked.",
        "Walking and idle-gap figures count known transitions only; "
        f"known weekly between-class walking: {walking_minutes_weekly} min.",
        *added,
        "Review the warnings before enrolling.",
    ]
