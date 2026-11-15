"""Search limits, read from the environment once at startup."""

from collections.abc import Mapping
from dataclasses import dataclass

MAX_SEARCH_STEPS_ENV = "DIGREE_MAX_SEARCH_STEPS"
MAX_OPTIONAL_COURSES_ENV = "DIGREE_MAX_OPTIONAL_COURSES"

# Upper bounds catch typos such as an extra zero before they hang the service.
SEARCH_STEPS_CEILING = 10_000_000
OPTIONAL_COURSES_CEILING = 200


@dataclass(frozen=True)
class SearchLimits:
    """Deterministic bounds on one search: the same request and limits give the same response."""

    max_search_steps: int = 100_000
    max_optional_courses: int = 20

    def __post_init__(self) -> None:
        _check("max_search_steps", self.max_search_steps, SEARCH_STEPS_CEILING)
        _check("max_optional_courses", self.max_optional_courses, OPTIONAL_COURSES_CEILING)


def load_search_limits(environ: Mapping[str, str]) -> SearchLimits:
    """Limits from the environment; unset or blank variables keep the defaults."""
    defaults = SearchLimits()
    return SearchLimits(
        max_search_steps=_read(
            environ, MAX_SEARCH_STEPS_ENV, defaults.max_search_steps, SEARCH_STEPS_CEILING
        ),
        max_optional_courses=_read(
            environ, MAX_OPTIONAL_COURSES_ENV, defaults.max_optional_courses, OPTIONAL_COURSES_CEILING
        ),
    )


def _read(environ: Mapping[str, str], name: str, default: int, ceiling: int) -> int:
    """One limit from the environment. Errors name the variable the operator set."""
    raw = environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be a whole number, got {raw!r}") from None
    _check(name, value, ceiling)
    return value


def _check(name: str, value: int, ceiling: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be a whole number, got {value!r}")
    if not 1 <= value <= ceiling:
        raise ValueError(f"{name} must be between 1 and {ceiling}, got {value}")
