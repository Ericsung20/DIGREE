"""Stable codes and wording the API emits: rejections, warnings, explanations.

Clients may branch on the codes, so they must not change without team
agreement. No text here may claim that the university has verified, approved
or guaranteed anything.
"""

# Keys of diagnostics.rejected_by_reason, in the order the checks run.
# Each rejected combination is counted once, under the first check it fails.
REJECTION_REASONS = (
    "credits_out_of_range",
    "section_full",
    "outside_time_window",
    "blocked_day",
    "time_overlap",
    "insufficient_walk_time",
    "walk_exceeds_max",
)

# diagnostics.no_results_reasons lists these, in this order, followed by the
# rejection reasons that occurred.
REQUIRED_COURSE_INELIGIBLE = "required_course_ineligible"
REQUIRED_COURSE_ALREADY_COMPLETED = "required_course_already_completed"
REQUIRED_COURSE_WITHOUT_BUNDLES = "required_course_without_bundles"

# Warning codes, in the order warnings are listed on a result. Every warning
# is the string "<code>: <message>".
WARNING_CODES = (
    "eligibility_unknown",
    "seat_status_unknown",
    "section_full_included",
    "building_unknown",
    "walking_time_unknown",
    "location_uncertain",
)

# Warnings that make a result needs_review. Today that is all of them; a later
# advisory warning can be added to WARNING_CODES without being listed here.
REVIEW_WARNING_CODES = frozenset(WARNING_CODES)

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


def explain(status: str, travel_complete: bool, walking_minutes_weekly: int) -> list[str]:
    """The `reasons` of a result. The ready sentence is fixed by the shared fixture."""
    if status == READY:
        return [
            "All selected courses fit; weekly between-class walking: "
            f"{walking_minutes_weekly} min."
        ]
    if travel_complete:
        return [
            "Class times do not overlap and every between-class walk was checked; "
            f"weekly between-class walking: {walking_minutes_weekly} min.",
            "Review the warnings before enrolling.",
        ]
    return [
        "Class times do not overlap, but travel between some classes could not be checked.",
        "Walking and idle-gap figures count known transitions only; "
        f"known weekly between-class walking: {walking_minutes_weekly} min.",
        "Review the warnings before enrolling.",
    ]
