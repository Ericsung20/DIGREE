"""Small request builders so each test states only what it is about."""

import json
from pathlib import Path

from app.config import SearchLimits
from app.engine import generate
from app.models import GenerateRequest, GenerateResponse

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = REPO_ROOT / "contracts" / "openapi.yaml"
FIXTURE_REQUEST_PATH = REPO_ROOT / "fixtures" / "request.json"
FIXTURE_EXPECTED_PATH = REPO_ROOT / "fixtures" / "expected.json"

WALKING_ONLY = {
    "walking": 1,
    "idle_gap": 0,
    "campus_days": 0,
    "grade_outcomes": 0,
    "degree_fit": 0,
    "instructor": 0,
}


def load_fixture_request() -> dict:
    return json.loads(FIXTURE_REQUEST_PATH.read_text())


def load_fixture_expected() -> dict:
    return json.loads(FIXTURE_EXPECTED_PATH.read_text())


def meeting(day: str, start: int, end: int, building: str | None = "ALPHA", mode: str = "in_person") -> dict:
    return {"day": day, "start_min": start, "end_min": end, "mode": mode, "building_id": building}


def bundle(bundle_id: str, meetings: list[dict], seat_status: str = "open") -> dict:
    return {
        "bundle_id": bundle_id,
        "seat_status": seat_status,
        "instructor_score": None,
        "meetings": meetings,
    }


def course(course_id: str, bundles: list[dict], credits: tuple[int, ...] = (3,), **overrides) -> dict:
    return {
        "course_id": course_id,
        "course_code": course_id.upper(),
        "credit_options": list(credits),
        "is_required": True,
        "eligibility_status": "eligible",
        "already_completed": False,
        "repeatable": False,
        "requirement_fit": None,
        "grade_stats": None,
        "section_bundles": bundles,
        **overrides,
    }


def edge(origin: str, destination: str, minutes: int, bidirectional: bool = True) -> dict:
    return {
        "from_building_id": origin,
        "to_building_id": destination,
        "minutes": minutes,
        "bidirectional": bidirectional,
    }


def request(courses: list[dict], edges: list[dict] | None = None, top_k: int = 5, weights: dict | None = None, **constraints) -> dict:
    """A permissive request: any credits, any time of day, no walking buffer."""
    return {
        "contract_version": "1.0",
        "request_id": "test",
        "term": "2027SP",
        "top_k": top_k,
        "constraints": {
            "min_credits": 0,
            "max_credits": 40,
            "earliest_start_min": 0,
            "latest_end_min": 1440,
            "blocked_days": [],
            "walking_buffer_min": 0,
            **constraints,
        },
        "preferences": {"weights": {**WALKING_ONLY, **(weights or {})}},
        "courses": courses,
        "walking_edges": edges or [],
    }


def run(payload: dict, limits: SearchLimits | None = None) -> GenerateResponse:
    return generate(GenerateRequest.model_validate(payload), limits or SearchLimits())


def bundle_ids(result) -> list[str]:
    return [selected.bundle_id for selected in result.selected]
