"""FastAPI entry point: routes and error mapping only. Logic lives in engine.py."""

import logging
import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import CONTRACT_VERSION, engine
from app.config import load_search_limits
from app.models import ApiError, ApiErrorBody, GenerateRequest, GenerateResponse, HealthResponse

logger = logging.getLogger("digree.optimizer")

# Read once at startup; an invalid value stops the service instead of being ignored.
SEARCH_LIMITS = load_search_limits(os.environ)

app = FastAPI(
    title="DIGREE Optimization API",
    version="1.0.0",
    description=(
        "Hackathon MVP contract v1.0. Receives anonymized, normalized data only. "
        "University enrollment and graduation eligibility are NOT verified by this API."
    ),
)

ERROR_RESPONSES = {
    422: {"model": ApiError, "description": "Malformed or internally inconsistent input"},
    503: {"model": ApiError, "description": "Optimizer cannot process the request"},
}


@app.get("/health", response_model=HealthResponse, operation_id="health")
def health() -> HealthResponse:
    return HealthResponse(status="ok", contract_version=CONTRACT_VERSION)


@app.post(
    "/v1/schedules/generate",
    response_model=GenerateResponse,
    responses=ERROR_RESPONSES,
    operation_id="generateSchedules",
)
def generate_schedules(request: GenerateRequest) -> GenerateResponse:
    return engine.generate(request, SEARCH_LIMITS)


def _error(status_code: int, code: str, message: str, details: list[str]) -> JSONResponse:
    body = ApiError(error=ApiErrorBody(code=code, message=message, details=details))
    return JSONResponse(status_code=status_code, content=body.model_dump())


def _field_path(location: tuple) -> str:
    """('body', 'courses', 0, 'course_id') -> 'courses[0].course_id'."""
    path = ""
    for part in location[1:] if location[:1] == ("body",) else location:
        if isinstance(part, int):
            path += f"[{part}]"
        else:
            path += f".{part}" if path else str(part)
    return path or "body"


@app.exception_handler(RequestValidationError)
def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    details = []
    for error in exc.errors():
        path = "body" if error["type"] == "json_invalid" else _field_path(tuple(error["loc"]))
        details.append(f"{path}: {error['msg'].removeprefix('Value error, ')}")
    return _error(422, "validation_error", "Request validation failed.", details)


@app.exception_handler(Exception)
def handle_internal_error(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled optimizer error", exc_info=exc)
    return _error(503, "internal_error", "The optimizer could not process the request.", [])
