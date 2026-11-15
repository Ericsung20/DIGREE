"""Smoke test for a running DIGREE optimizer. Standard library only.

    python scripts/smoke.py                         # checks http://127.0.0.1:8000
    python scripts/smoke.py http://localhost:9000   # another address

It sends the shared fixture request and three one-field variations of it, and
compares the answers as parsed JSON. Exit status is 0 when every check passes.

HTTP 503 `internal_error` cannot be provoked on a healthy server; it is covered
by tests/test_contract.py::test_unexpected_failure_returns_503_internal_error.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"
GENERATE = "/v1/schedules/generate"


def call(base_url: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    """Status code and parsed JSON body of one request."""
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="GET" if body is None else "POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("base_url", nargs="?", default="http://127.0.0.1:8000")
    parser.add_argument(
        "--fixtures",
        type=Path,
        default=DEFAULT_FIXTURES,
        help="directory holding request.json and expected.json (default: the repository's fixtures/)",
    )
    args = parser.parse_args()

    fixture = json.loads((args.fixtures / "request.json").read_text())
    expected = json.loads((args.fixtures / "expected.json").read_text())
    failures = 0

    def check(name: str, passed: bool, detail: str = "") -> None:
        nonlocal failures
        failures += not passed
        print(f"{'PASS' if passed else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))

    try:
        status, body = call(args.base_url, "/health")
    except OSError as error:
        print(f"FAIL  cannot reach {args.base_url}: {error}")
        return 1
    check("GET /health", (status, body) == (200, {"status": "ok", "contract_version": "1.0"}), f"HTTP {status}")

    status, body = call(args.base_url, GENERATE, fixture)
    check("baseline fixture equals expected.json", status == 200 and body == expected, f"HTTP {status}")

    # 422: all six weights zero is an inconsistent request.
    invalid = copy.deepcopy(fixture)
    invalid["preferences"]["weights"] = dict.fromkeys(invalid["preferences"]["weights"], 0)
    status, body = call(args.base_url, GENERATE, invalid)
    error = body.get("error", {})
    check(
        "invalid request -> 422 validation_error",
        status == 422 and error.get("code") == "validation_error" and bool(error.get("details")),
        f"HTTP {status}",
    )

    # 200 with no results: no class may start before 11:40, and every schedule has one that does.
    impossible = copy.deepcopy(fixture)
    impossible["constraints"]["earliest_start_min"] = 700
    status, body = call(args.base_url, GENERATE, impossible)
    diagnostics = body.get("diagnostics", {})
    check(
        "no feasible schedule -> 200 with empty results and a reason",
        status == 200
        and body.get("results") == []
        and diagnostics.get("no_results_reasons") == ["outside_time_window"],
        f"HTTP {status}, reasons {diagnostics.get('no_results_reasons')}",
    )

    # 200 with needs_review: one section's seat availability is unknown.
    uncertain = copy.deepcopy(fixture)
    uncertain["courses"][0]["section_bundles"][0]["seat_status"] = "unknown"
    status, body = call(args.base_url, GENERATE, uncertain)
    results = body.get("results", [])
    statuses = [result["status"] for result in results]
    flagged = [r for r in results if r["status"] == "needs_review"]
    check(
        "unknown seat status -> 200 with needs_review and a warning",
        status == 200
        and statuses == ["ready", "needs_review", "needs_review"]
        and all(r["warnings"][0].startswith("seat_status_unknown: ") for r in flagged),
        f"HTTP {status}, statuses {statuses}",
    )

    print("all checks passed" if not failures else f"{failures} check(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
