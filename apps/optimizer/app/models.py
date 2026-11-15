"""Pydantic models mirroring contracts/openapi.yaml (contract v1.0).

Field names, enums and bounds come from the contract and must not change
without a contract revision. Every model forbids unknown fields and validates
strictly: integer fields accept JSON integers only, with no string coercion.

Cross-field rules that OpenAPI cannot express are enforced here and surface
as HTTP 422.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Day = Literal["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
Mode = Literal["in_person", "hybrid", "online_sync"]
SeatStatus = Literal["open", "full", "unknown"]
EligibilityStatus = Literal["eligible", "ineligible", "unknown"]
ResultStatus = Literal["ready", "needs_review"]
ContractVersion = Literal["1.0"]

Weight = Annotated[float, Field(ge=0, le=1)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


# --------------------------------------------------------------------------
# Request
# --------------------------------------------------------------------------


class Meeting(ContractModel):
    day: Day
    start_min: int = Field(ge=0, le=1439)
    end_min: int = Field(ge=1, le=1440)
    mode: Mode
    building_id: str | None = None

    @model_validator(mode="after")
    def _start_before_end(self) -> "Meeting":
        if self.start_min >= self.end_min:
            raise ValueError("start_min must be less than end_min")
        return self


class SectionBundle(ContractModel):
    bundle_id: str = Field(min_length=1)
    meetings: list[Meeting]
    seat_status: SeatStatus
    instructor_score: float | None = Field(default=None, ge=0, le=1)


class GradeStats(ContractModel):
    a_ab_rate: float = Field(ge=0, le=1)
    sample_size: int = Field(ge=0)


class CandidateCourse(ContractModel):
    course_id: str
    course_code: str
    credit_options: list[Annotated[int, Field(ge=1, le=30)]] = Field(min_length=1)
    is_required: bool
    is_major_course: bool = False
    eligibility_status: EligibilityStatus
    already_completed: bool
    repeatable: bool
    requirement_fit: float | None = Field(default=None, ge=0, le=1)
    breadth: list[Annotated[str, Field(min_length=1)]] | None = None
    grade_stats: GradeStats | None = None
    section_bundles: list[SectionBundle]

    @model_validator(mode="after")
    def _unique_bundle_ids(self) -> "CandidateCourse":
        duplicates = _duplicates(b.bundle_id for b in self.section_bundles)
        if duplicates:
            raise ValueError(f"duplicate bundle_id within course: {', '.join(duplicates)}")
        return self


class Constraints(ContractModel):
    min_credits: int = Field(ge=0, le=40)
    max_credits: int = Field(ge=0, le=40)
    earliest_start_min: int = Field(ge=0, le=1439)
    latest_end_min: int = Field(ge=1, le=1440)
    blocked_days: list[Day]
    walking_buffer_min: int = Field(ge=0, le=60)
    max_walk_per_transition_min: int | None = Field(default=None, ge=0, le=120)
    max_major_courses: int | None = Field(default=None, ge=0, le=6)
    exclude_full_sections: bool = False

    @model_validator(mode="after")
    def _consistent(self) -> "Constraints":
        if self.min_credits > self.max_credits:
            raise ValueError("min_credits must be less than or equal to max_credits")
        duplicates = _duplicates(self.blocked_days)
        if duplicates:
            raise ValueError(f"blocked_days must be unique: {', '.join(duplicates)}")
        return self


class Weights(ContractModel):
    walking: Weight
    idle_gap: Weight
    campus_days: Weight
    grade_outcomes: Weight
    degree_fit: Weight
    instructor: Weight
    breadth: Weight = 0
    major_balance: Weight = 0

    @model_validator(mode="after")
    def _not_all_zero(self) -> "Weights":
        if not any(self.model_dump().values()):
            raise ValueError("at least one weight must be greater than 0")
        return self


class Preferences(ContractModel):
    weights: Weights
    preferred_breadths: list[Annotated[str, Field(min_length=1)]] = Field(default_factory=list, max_length=16)
    catalog_search: bool = False

    @model_validator(mode="after")
    def _valid_breadths(self) -> "Preferences":
        if any(not code.strip() for code in self.preferred_breadths):
            raise ValueError("preferred_breadths must not contain blank values")
        if len({code.strip().casefold() for code in self.preferred_breadths}) != len(self.preferred_breadths):
            raise ValueError("preferred_breadths must be unique")
        return self


class WalkingEdge(ContractModel):
    from_building_id: str
    to_building_id: str
    minutes: int = Field(ge=0)
    bidirectional: bool = True


class GenerateRequest(ContractModel):
    contract_version: ContractVersion
    request_id: str = Field(min_length=1)
    term: str
    top_k: int = Field(ge=1, le=5)
    constraints: Constraints
    preferences: Preferences
    courses: list[CandidateCourse] = Field(min_length=1)
    walking_edges: list[WalkingEdge]

    @model_validator(mode="after")
    def _consistent(self) -> "GenerateRequest":
        duplicates = _duplicates(c.course_id for c in self.courses)
        if duplicates:
            raise ValueError(f"duplicate course_id: {', '.join(duplicates)}")
        walking_minutes_by_pair(self.walking_edges)
        return self


def walking_minutes_by_pair(edges: list[WalkingEdge]) -> dict[tuple[str, str], int]:
    """Expand edges into a directed (from, to) -> minutes lookup.

    Raises ValueError when two edges disagree about the same directed pair, or
    when an edge gives a non-zero time from a building to itself (the same
    building is always 0 minutes).
    """
    minutes_by_pair: dict[tuple[str, str], int] = {}
    for edge in edges:
        pairs = [(edge.from_building_id, edge.to_building_id)]
        if edge.bidirectional:
            pairs.append((edge.to_building_id, edge.from_building_id))
        for pair in pairs:
            if pair[0] == pair[1]:
                if edge.minutes != 0:
                    raise ValueError(
                        f"walking edge {pair[0]} -> {pair[1]} must be 0 minutes for the same building"
                    )
                continue
            known = minutes_by_pair.setdefault(pair, edge.minutes)
            if known != edge.minutes:
                raise ValueError(
                    f"conflicting walking edges for {pair[0]} -> {pair[1]}: "
                    f"{known} and {edge.minutes} minutes"
                )
    return minutes_by_pair


def _duplicates(values) -> list[str]:
    seen: set[str] = set()
    duplicates: list[str] = []
    for value in values:
        if value in seen and value not in duplicates:
            duplicates.append(value)
        seen.add(value)
    return duplicates


# --------------------------------------------------------------------------
# Response
# --------------------------------------------------------------------------


class SelectedBundle(ContractModel):
    course_id: str
    course_code: str
    bundle_id: str
    credits: int = Field(ge=1)
    meetings: list[Meeting]


class Metrics(ContractModel):
    total_credits: int
    walking_minutes_weekly: int
    idle_gap_minutes_weekly: int
    campus_days: int


class ScheduleResult(ContractModel):
    rank: int = Field(ge=1)
    score: float = Field(ge=0, le=100)
    status: ResultStatus
    selected: list[SelectedBundle]
    metrics: Metrics
    warnings: list[str]
    reasons: list[str]


class Diagnostics(ContractModel):
    explored_combinations: int = Field(ge=0)
    rejected_by_reason: dict[str, Annotated[int, Field(ge=0)]]
    search_truncated: bool
    no_results_reasons: list[str]


class GenerateResponse(ContractModel):
    contract_version: ContractVersion
    request_id: str
    term: str
    results: list[ScheduleResult]
    diagnostics: Diagnostics


class HealthResponse(ContractModel):
    status: Literal["ok"]
    contract_version: ContractVersion


class ApiErrorBody(BaseModel):
    code: str
    message: str
    details: list[str] = Field(default_factory=list)


class ApiError(BaseModel):
    error: ApiErrorBody
