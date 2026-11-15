"""The HTTP surface against the shared contract and fixtures."""

import copy
from typing import get_args

import pytest
import yaml
from fastapi.testclient import TestClient

from app import engine, models
from app.main import app
from tests.builders import (
    CONTRACT_PATH,
    FIXTURE_EXPECTED_PATH,
    FIXTURE_REQUEST_PATH,
    REPO_ROOT,
    bundle,
    course,
    load_fixture_expected,
    load_fixture_request,
    meeting,
)

GENERATE = "/v1/schedules/generate"


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def fixture_request() -> dict:
    return load_fixture_request()


@pytest.fixture(scope="module")
def contract() -> dict:
    return yaml.safe_load(CONTRACT_PATH.read_text())


# --------------------------------------------------------------------------
# Fixture and endpoints
# --------------------------------------------------------------------------


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "contract_version": "1.0"}


def test_fixture_request_returns_expected_response_exactly(client, fixture_request):
    """T01: the whole body matches, including metrics and diagnostics."""
    response = client.post(GENERATE, json=fixture_request)
    assert response.status_code == 200
    assert response.json() == load_fixture_expected()


def test_fixture_top_three(client, fixture_request):
    results = client.post(GENERATE, json=fixture_request).json()["results"]
    summary = [
        (
            r["rank"],
            [s["bundle_id"] for s in r["selected"]],
            r["metrics"]["walking_minutes_weekly"],
            r["score"],
        )
        for r in results
    ]
    assert summary == [
        (1, ["cs400-B", "math234-B", "stat240-A"], 0, 100.0),
        (2, ["cs400-A", "math234-A", "stat240-A"], 12, 67.03),
        (3, ["cs400-A", "math234-B", "stat240-A"], 36, 30.12),
    ]


def test_fixture_rejects_the_overlapping_combination(client, fixture_request):
    body = client.post(GENERATE, json=fixture_request).json()
    assert body["diagnostics"] == {
        "explored_combinations": 4,
        "rejected_by_reason": {"time_overlap": 1},
        "search_truncated": False,
        "no_results_reasons": [],
    }
    chosen = [{s["bundle_id"] for s in r["selected"]} for r in body["results"]]
    assert not any({"cs400-B", "math234-A"} <= bundles for bundles in chosen)


def test_no_feasible_schedule_is_a_200_with_empty_results(client, fixture_request):
    """T15: an empty result is a business answer, not an error."""
    fixture_request["constraints"]["earliest_start_min"] = 700
    response = client.post(GENERATE, json=fixture_request)
    assert response.status_code == 200
    body = response.json()
    assert body["results"] == []
    assert body["diagnostics"]["explored_combinations"] == 4
    assert body["diagnostics"]["rejected_by_reason"] == {"outside_time_window": 4}
    assert body["diagnostics"]["no_results_reasons"] == ["outside_time_window"]


# --------------------------------------------------------------------------
# Shared files and schema drift
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "canonical, duplicate",
    [
        (CONTRACT_PATH, REPO_ROOT / "contracts" / "DIGREE_API_CONTRACT_v1.yaml"),
        (FIXTURE_REQUEST_PATH, REPO_ROOT / "fixtures" / "DIGREE_fixture_request.json"),
        (FIXTURE_EXPECTED_PATH, REPO_ROOT / "fixtures" / "DIGREE_fixture_expected_response.json"),
    ],
    ids=["contract", "request", "expected"],
)
def test_duplicate_shared_files_have_not_drifted(canonical, duplicate):
    if not duplicate.exists():
        pytest.skip(f"{duplicate.name} is no longer in the repository")
    assert canonical.read_bytes() == duplicate.read_bytes()


def test_fixtures_validate_against_the_models():
    models.GenerateRequest.model_validate(load_fixture_request())
    models.GenerateResponse.model_validate(load_fixture_expected())


SCHEMA_MODELS = {
    "Meeting": models.Meeting,
    "SectionBundle": models.SectionBundle,
    "GradeStats": models.GradeStats,
    "CandidateCourse": models.CandidateCourse,
    "Constraints": models.Constraints,
    "Weights": models.Weights,
    "Preferences": models.Preferences,
    "WalkingEdge": models.WalkingEdge,
    "GenerateRequest": models.GenerateRequest,
    "SelectedBundle": models.SelectedBundle,
    "Metrics": models.Metrics,
    "ScheduleResult": models.ScheduleResult,
    "Diagnostics": models.Diagnostics,
    "GenerateResponse": models.GenerateResponse,
    "ApiError": models.ApiError,
}


def _bounds(schema: dict) -> dict:
    """Numeric and length limits of a property, looking through nullable wrappers."""
    keys = ("minimum", "maximum", "minLength", "minItems")
    found = {key: schema[key] for key in keys if key in schema}
    for option in schema.get("anyOf", []):
        found.update(_bounds(option))
    if "items" in schema:
        found.update({f"items.{key}": value for key, value in _bounds(schema["items"]).items()})
    return found


@pytest.mark.parametrize("name", SCHEMA_MODELS)
def test_model_matches_contract_schema(contract, name):
    schema = contract["components"]["schemas"][name]
    model = SCHEMA_MODELS[name]
    required = {field for field, info in model.model_fields.items() if info.is_required()}

    assert set(model.model_fields) == set(schema["properties"])
    assert required == set(schema.get("required", []))

    generated = model.model_json_schema()["properties"]
    for field, contract_property in schema["properties"].items():
        assert _bounds(generated[field]) == _bounds(contract_property), field


def test_enums_match_contract(contract):
    schemas = contract["components"]["schemas"]

    def enum(schema: str, field: str) -> list[str]:
        return schemas[schema]["properties"][field]["enum"]

    assert list(get_args(models.Day)) == schemas["Day"]["enum"]
    assert list(get_args(models.Mode)) == schemas["Mode"]["enum"]
    assert list(get_args(models.SeatStatus)) == enum("SectionBundle", "seat_status")
    assert list(get_args(models.EligibilityStatus)) == enum("CandidateCourse", "eligibility_status")
    assert list(get_args(models.ResultStatus)) == enum("ScheduleResult", "status")
    assert list(get_args(models.ContractVersion)) == enum("GenerateRequest", "contract_version")
    assert list(get_args(models.ContractVersion)) == enum("GenerateResponse", "contract_version")


def test_contract_paths_are_served(contract):
    served = app.openapi()["paths"]
    for path, operations in contract["paths"].items():
        for method, operation in operations.items():
            assert served[path][method]["operationId"] == operation["operationId"]
            assert set(operation["responses"]) <= set(served[path][method]["responses"])


# --------------------------------------------------------------------------
# 422: malformed or internally inconsistent input
# --------------------------------------------------------------------------


def _first_meeting(request: dict) -> dict:
    return request["courses"][0]["section_bundles"][0]["meetings"][0]


INVALID_REQUESTS = {
    "missing field": (lambda r: r.pop("term"), "term: "),
    "unknown field": (lambda r: r.update(user_id="u1"), "user_id: "),
    "wrong contract version": (lambda r: r.update(contract_version="2.0"), "contract_version: "),
    "top_k above 5": (lambda r: r.update(top_k=6), "top_k: "),
    "top_k below 1": (lambda r: r.update(top_k=0), "top_k: "),
    "float for integer": (lambda r: r.update(top_k=3.0), "top_k: "),
    "empty request_id": (lambda r: r.update(request_id=""), "request_id: "),
    "empty courses": (lambda r: r.update(courses=[]), "courses: "),
    "string for integer": (
        lambda r: r["constraints"].update(min_credits="10"),
        "constraints.min_credits: ",
    ),
    "boolean for integer": (
        lambda r: r["constraints"].update(walking_buffer_min=True),
        "constraints.walking_buffer_min: ",
    ),
    "min_credits above max_credits": (
        lambda r: r["constraints"].update(min_credits=12),
        "constraints: min_credits must be less than or equal to max_credits",
    ),
    "duplicate blocked days": (
        lambda r: r["constraints"].update(blocked_days=["FRI", "FRI"]),
        "constraints: blocked_days must be unique",
    ),
    "unknown day": (
        lambda r: _first_meeting(r).update(day="Mon"),
        "courses[0].section_bundles[0].meetings[0].day: ",
    ),
    "start not before end": (
        lambda r: _first_meeting(r).update(start_min=650),
        "courses[0].section_bundles[0].meetings[0]: start_min must be less than end_min",
    ),
    "start out of range": (
        lambda r: _first_meeting(r).update(start_min=-1),
        "courses[0].section_bundles[0].meetings[0].start_min: ",
    ),
    "empty credit options": (
        lambda r: r["courses"][0].update(credit_options=[]),
        "courses[0].credit_options: ",
    ),
    "credit option out of range": (
        lambda r: r["courses"][0].update(credit_options=[0]),
        "courses[0].credit_options[0]: ",
    ),
    "duplicate course_id": (
        lambda r: r["courses"][1].update(course_id="cs400"),
        "duplicate course_id: cs400",
    ),
    "duplicate bundle_id in a course": (
        lambda r: r["courses"][0]["section_bundles"][1].update(bundle_id="cs400-A"),
        "courses[0]: duplicate bundle_id within course: cs400-A",
    ),
    "all weights zero": (
        lambda r: r["preferences"]["weights"].update(walking=0),
        "preferences.weights: at least one weight must be greater than 0",
    ),
    "negative weight": (
        lambda r: r["preferences"]["weights"].update(idle_gap=-0.1),
        "preferences.weights.idle_gap: ",
    ),
    "weight above 1": (
        lambda r: r["preferences"]["weights"].update(walking=1.5),
        "preferences.weights.walking: ",
    ),
    "negative walking minutes": (
        lambda r: r["walking_edges"][0].update(minutes=-1),
        "walking_edges[0].minutes: ",
    ),
    "conflicting walking edges": (
        lambda r: r["walking_edges"].append(
            {"from_building_id": "ALPHA", "to_building_id": "BETA", "minutes": 9}
        ),
        "conflicting walking edges for ALPHA -> BETA: 6 and 9 minutes",
    ),
    "one-way edge conflicts with two-way edge": (
        lambda r: r["walking_edges"].append(
            {
                "from_building_id": "BETA",
                "to_building_id": "ALPHA",
                "minutes": 9,
                "bidirectional": False,
            }
        ),
        "conflicting walking edges for BETA -> ALPHA: 6 and 9 minutes",
    ),
    "non-zero walk within one building": (
        lambda r: r["walking_edges"].append(
            {"from_building_id": "ALPHA", "to_building_id": "ALPHA", "minutes": 2}
        ),
        "walking edge ALPHA -> ALPHA must be 0 minutes for the same building",
    ),
}


@pytest.mark.parametrize("case", INVALID_REQUESTS)
def test_invalid_request_returns_422(client, fixture_request, case):
    mutate, expected_detail = INVALID_REQUESTS[case]
    mutate(fixture_request)

    response = client.post(GENERATE, json=fixture_request)

    assert response.status_code == 422
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["message"] == "Request validation failed."
    assert any(expected_detail in detail for detail in body["error"]["details"]), body


def test_malformed_json_returns_422(client):
    response = client.post(
        GENERATE, content=b'{"contract_version": ', headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert response.json()["error"]["details"][0].startswith("body: ")


def test_identical_duplicate_walking_edges_are_accepted(client, fixture_request):
    fixture_request["walking_edges"].append(copy.deepcopy(fixture_request["walking_edges"][0]))
    response = client.post(GENERATE, json=fixture_request)
    assert response.status_code == 200
    assert response.json() == load_fixture_expected()


# --------------------------------------------------------------------------
# Requests that stay close to the fixture
# --------------------------------------------------------------------------


def _first_bundle(request: dict) -> dict:
    return request["courses"][0]["section_bundles"][0]


def _optional_course(**overrides) -> dict:
    return course(
        "art100",
        [bundle("art100-A", [meeting("FRI", 600, 650, "ALPHA")])],
        is_required=False,
        **overrides,
    )


SUPPORTED_VARIATIONS = {
    "optional course that is not needed": lambda r: r["courses"].append(_optional_course()),
    "unused optional course with unknown data": lambda r: r["courses"].append(
        _optional_course(eligibility_status="unknown")
    ),
    "completed but repeatable required course": lambda r: r["courses"][0].update(
        already_completed=True, repeatable=True
    ),
    "exclusion on with no full sections": lambda r: r["constraints"].update(
        exclude_full_sections=True
    ),
    "optional fields omitted": lambda r: (
        r["constraints"].pop("exclude_full_sections"),
        [e.pop("bidirectional") for e in r["walking_edges"]],
        [c.pop("requirement_fit") and None for c in r["courses"]],
        [c.pop("grade_stats") and None for c in r["courses"]],
    ),
}


@pytest.mark.parametrize("case", SUPPORTED_VARIATIONS)
def test_variation_that_needs_no_new_behaviour_still_matches_fixture(client, fixture_request, case):
    SUPPORTED_VARIATIONS[case](fixture_request)
    response = client.post(GENERATE, json=fixture_request)
    assert response.status_code == 200
    assert response.json() == load_fixture_expected()


# --------------------------------------------------------------------------
# Unknown data and the remaining hard constraints (Milestone B)
#
# These scenarios returned a temporary 503 in Milestone A. Each is the fixture
# request with one change, so results are named by their CS 400 and MATH 234
# bundles; STAT 240 is always stat240-A.
# --------------------------------------------------------------------------

BB = ["cs400-B", "math234-B"]  # fixture rank 1, never touched by these changes
AA = ["cs400-A", "math234-A"]  # fixture rank 2
AB = ["cs400-A", "math234-B"]  # fixture rank 3

FIXTURE_DIAGNOSTICS = {
    "explored_combinations": 4,
    "rejected_by_reason": {"time_overlap": 1},
    "search_truncated": False,
    "no_results_reasons": [],
}


def _nothing_explored(reason: str) -> dict:
    return {
        "explored_combinations": 0,
        "rejected_by_reason": {},
        "search_truncated": False,
        "no_results_reasons": [reason],
    }


# name -> (change to the fixture, expected (bundles, score, status, warning codes), diagnostics)
REVIEW_SCENARIOS = {
    "required course with unknown eligibility": (
        lambda r: r["courses"][1].update(eligibility_status="unknown"),
        [
            (BB, 100.0, "needs_review", ["eligibility_unknown"]),
            (AA, 67.03, "needs_review", ["eligibility_unknown"]),
            (AB, 30.12, "needs_review", ["eligibility_unknown"]),
        ],
        FIXTURE_DIAGNOSTICS,
    ),
    "required course that is ineligible": (
        lambda r: r["courses"][1].update(eligibility_status="ineligible"),
        [],
        _nothing_explored("required_course_ineligible"),
    ),
    "required course completed and not repeatable": (
        lambda r: r["courses"][0].update(already_completed=True),
        [],
        _nothing_explored("required_course_already_completed"),
    ),
    "unknown seat status": (
        lambda r: _first_bundle(r).update(seat_status="unknown"),
        [
            (BB, 100.0, "ready", []),
            (AA, 67.03, "needs_review", ["seat_status_unknown"]),
            (AB, 30.12, "needs_review", ["seat_status_unknown"]),
        ],
        FIXTURE_DIAGNOSTICS,
    ),
    "full section with exclusion enabled": (
        lambda r: (
            _first_bundle(r).update(seat_status="full"),
            r["constraints"].update(exclude_full_sections=True),
        ),
        [(BB, 100.0, "ready", [])],
        {**FIXTURE_DIAGNOSTICS, "rejected_by_reason": {"section_full": 2, "time_overlap": 1}},
    ),
    "full section while exclusion is off": (
        lambda r: _first_bundle(r).update(seat_status="full"),
        [
            (BB, 100.0, "ready", []),
            (AA, 67.03, "needs_review", ["section_full_included"]),
            (AB, 30.12, "needs_review", ["section_full_included"]),
        ],
        FIXTURE_DIAGNOSTICS,
    ),
    # Monday's cs400-A meeting goes online, so only Wednesday's walk is known.
    # Both schedules score the neutral half and tie; IDs decide the order.
    "online_sync meeting": (
        lambda r: _first_meeting(r).update(mode="online_sync", building_id=None),
        [
            (BB, 100.0, "ready", []),
            (AA, 50.0, "needs_review", ["location_uncertain"]),
            (AB, 50.0, "needs_review", ["location_uncertain"]),
        ],
        FIXTURE_DIAGNOSTICS,
    ),
    "hybrid meeting": (
        lambda r: _first_meeting(r).update(mode="hybrid"),
        [(BB, 100.0, "ready", []), (AA, 67.03, "ready", []), (AB, 30.12, "ready", [])],
        FIXTURE_DIAGNOSTICS,
    ),
    "in-person meeting without a building": (
        lambda r: _first_meeting(r).update(building_id=None),
        [
            (BB, 100.0, "ready", []),
            (AA, 50.0, "needs_review", ["building_unknown"]),
            (AB, 50.0, "needs_review", ["building_unknown"]),
        ],
        FIXTURE_DIAGNOSTICS,
    ),
    # Without ALPHA-BETA, cs400-A + math234-A has no known walking. It scores
    # the neutral half, not 100, and ranks below every ready schedule.
    "missing walking edge on a surviving schedule": (
        lambda r: r["walking_edges"].pop(0),
        [
            (BB, 100.0, "ready", []),
            (AB, 30.12, "ready", []),
            (AA, 50.0, "needs_review", ["walking_time_unknown"]),
        ],
        FIXTURE_DIAGNOSTICS,
    ),
}


@pytest.mark.parametrize("case", REVIEW_SCENARIOS)
def test_unknown_data_returns_200_with_review_status_or_a_reason(client, fixture_request, case):
    mutate, expected_results, expected_diagnostics = REVIEW_SCENARIOS[case]
    mutate(fixture_request)

    response = client.post(GENERATE, json=fixture_request)

    assert response.status_code == 200
    body = response.json()
    models.GenerateResponse.model_validate(body)
    assert [
        (
            [s["bundle_id"] for s in r["selected"]][:2],
            r["score"],
            r["status"],
            [warning.split(": ")[0] for warning in r["warnings"]],
        )
        for r in body["results"]
    ] == expected_results
    assert [r["rank"] for r in body["results"]] == list(range(1, len(expected_results) + 1))
    assert body["diagnostics"] == expected_diagnostics
    if expected_results and expected_results[0] == (BB, 100.0, "ready", []):
        # The untouched schedule is still returned exactly as the shared fixture has it.
        assert body["results"][0] == load_fixture_expected()["results"][0]


# --------------------------------------------------------------------------
# Optional courses and the data-driven weights (Milestone C)
#
# These scenarios returned a temporary 503 until Milestone C. Each is the
# fixture request with one change.
# --------------------------------------------------------------------------

FIXTURE_SUMMARY = [
    (["cs400-B", "math234-B", "stat240-A"], 100.0, "ready"),
    (["cs400-A", "math234-A", "stat240-A"], 67.03, "ready"),
    (["cs400-A", "math234-B", "stat240-A"], 30.12, "ready"),
]


def _summary(body: dict) -> list[tuple]:
    return [
        ([s["bundle_id"] for s in r["selected"]], r["score"], r["status"]) for r in body["results"]
    ]


@pytest.mark.parametrize("weight", ["grade_outcomes", "degree_fit"])
def test_weight_about_optional_courses_changes_nothing_when_none_are_selected(
    client, fixture_request, weight
):
    """Formerly '<weight> weight' -> 503. Every course is required, so the
    factor is the same for every schedule and is left out of the score."""
    fixture_request["preferences"]["weights"][weight] = 0.5
    response = client.post(GENERATE, json=fixture_request)
    assert response.status_code == 200
    assert response.json() == load_fixture_expected()


def test_instructor_weight_without_any_ratings_is_reported_not_scored(client, fixture_request):
    """Formerly 'instructor weight' -> 503."""
    fixture_request["preferences"]["weights"]["instructor"] = 1
    response = client.post(GENERATE, json=fixture_request)
    assert response.status_code == 200
    body = response.json()
    assert _summary(body) == FIXTURE_SUMMARY
    assert body["diagnostics"] == FIXTURE_DIAGNOSTICS
    for result in body["results"]:
        assert result["warnings"] == [
            "instructor_data_missing: No instructor ratings were provided; "
            "the instructor preference did not affect the score."
        ]


def test_optional_course_fills_the_credit_range(client, fixture_request):
    """Formerly 'optional courses needed for credits' -> 503.

    CS 400 + MATH 234 give 7 of the 10 credits, so STAT 240 is added. Counted
    combinations: 2 x 2 bundles x (take or leave STAT 240) = 8.
    """
    fixture_request["courses"][2]["is_required"] = False
    response = client.post(GENERATE, json=fixture_request)
    assert response.status_code == 200
    body = response.json()
    models.GenerateResponse.model_validate(body)
    assert _summary(body) == FIXTURE_SUMMARY
    expected = load_fixture_expected()["results"]
    for result, baseline in zip(body["results"], expected):
        assert result["selected"] == baseline["selected"]
        assert result["metrics"] == baseline["metrics"]
        assert result["warnings"] == []
        assert result["reasons"] == baseline["reasons"] + ["Optional courses selected: STAT 240."]
    assert body["diagnostics"] == {
        "explored_combinations": 8,
        "rejected_by_reason": {"credits_out_of_range": 3, "time_overlap": 2},
        "search_truncated": False,
        "no_results_reasons": [],
    }


def test_request_with_no_required_course_selects_among_optional_ones(client, fixture_request):
    """Formerly 'no required course at all' -> 503.

    With 0 to 10 credits allowed, every non-empty set of the three courses is
    a schedule. Several walk 0 minutes and tie at 100; IDs decide the order.
    """
    for candidate in fixture_request["courses"]:
        candidate["is_required"] = False
    fixture_request["constraints"]["min_credits"] = 0
    response = client.post(GENERATE, json=fixture_request)
    assert response.status_code == 200
    body = response.json()
    models.GenerateResponse.model_validate(body)
    assert _summary(body) == [
        (["cs400-A"], 100.0, "ready"),
        (["cs400-A", "stat240-A"], 100.0, "ready"),
        (["cs400-B"], 100.0, "ready"),
    ]
    assert all(result["selected"] for result in body["results"])
    assert body["diagnostics"] == {
        "explored_combinations": 17,  # 3 x 3 x 2 choices, less the empty selection
        "rejected_by_reason": {"time_overlap": 2},
        "search_truncated": False,
        "no_results_reasons": [],
    }


def test_not_implemented_is_no_longer_returned(client, fixture_request):
    """Every temporary guard is gone: the busiest request the contract allows is answered."""
    fixture_request["preferences"]["weights"].update(
        walking=1, idle_gap=1, campus_days=1, grade_outcomes=1, degree_fit=1, instructor=1
    )
    fixture_request["courses"][2]["is_required"] = False
    fixture_request["courses"].append(_optional_course(eligibility_status="unknown"))
    fixture_request["constraints"].update(min_credits=10, max_credits=13)
    response = client.post(GENERATE, json=fixture_request)
    assert response.status_code == 200
    assert response.json()["results"]


def test_unexpected_failure_returns_503_internal_error(fixture_request, monkeypatch):
    def explode(_):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(engine, "generate", explode)
    response = TestClient(app, raise_server_exceptions=False).post(GENERATE, json=fixture_request)

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "internal_error",
            "message": "The optimizer could not process the request.",
            "details": [],
        }
    }
