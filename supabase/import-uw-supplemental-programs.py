"""Import official undergraduate certificate and minor catalog entries from UW Guide."""

import argparse
import json
import re
import runpy
from datetime import datetime, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5


parser = runpy.run_path(str(Path(__file__).with_name("import-uw-program-requirements.py")))
GUIDE = parser["GUIDE"]


def map_programs(directory, indexes, years):
    programs = {}
    for year in years:
        prefix = "" if year == 2026 else f"/archive/{year}-{year + 1}"
        index = indexes / f"index-{year}.html"
        sources = [index, *sorted(directory.glob(f"education-{year}-*.html"))]
        if len(sources) == 1:
            raise ValueError(f"Missing School of Education index for {year}")
        for source in sources:
            for label, paths in parser["program_links"](source.read_text(encoding="utf-8"), year).items():
                for path in paths:
                    kind = path.rstrip("/").rsplit("-", 1)[-1]
                    if kind not in {"certificate", "minor"} or not label.endswith(f", {kind}"):
                        continue
                    key = path.removeprefix(f"{prefix}/undergraduate/").strip("/")
                    url = GUIDE + path
                    programs[year, key] = {
                        "id": str(uuid5(NAMESPACE_URL, url)), "catalog_year": year,
                        "program_key": key, "kind": kind, "url": url,
                    }
    entries = [entry for _, entry in sorted(programs.items())]
    parser["write_json"](directory / "mapped.json", entries)
    print(json.dumps({"mapped": len(entries)}))


def stage_programs(directory):
    programs = parser["load_json"](directory / "mapped.json")
    issues = []
    rows = []
    captured = datetime.now(timezone.utc).isoformat()
    for program in programs:
        file = directory / "pages" / (program["id"] + ".html")
        if not file.is_file():
            issues.append({**program, "issue": "page unavailable"})
            continue
        html = file.read_text(encoding="utf-8")
        title, requirements = parser["extract_requirements"](html, include_conditions=True)
        declaration = parser["extract_requirements"](
            html, include_conditions=True, section_id="howtogetintextcontainer",
        )[1]
        if not title.casefold().endswith(", " + program["kind"]) or not requirements:
            issues.append({**program, "issue": "title mismatch or empty requirements", "actual": title})
            continue
        rows.append({
            **{key: program[key] for key in ("catalog_year", "program_key", "kind")},
            "name": title, "source_url": program["url"], "course_groups": requirements,
            "declaration_groups": declaration or [], "fetched_at": captured,
        })
    parser["write_json"](directory / "extraction-issues.json", issues)
    parser["write_json"](directory / "supplemental-programs.json", rows)
    print(json.dumps({"staged": len(rows), "issues": len(issues)}))
    if issues:
        raise SystemExit(1)

    fields = ("catalog_year integer, program_key text, kind text, name text, source_url text, "
              "course_groups jsonb, declaration_groups jsonb, fetched_at timestamptz")
    columns = ", ".join(field.split()[0] for field in fields.split(", "))
    batch_files = []
    for offset in range(0, len(rows), 20):
        payload = json.dumps(rows[offset:offset + 20], ensure_ascii=False, separators=(",", ":"))
        escaped = payload.replace("\\", "\\\\").replace("'", "''")
        path = directory / f"supplemental-{offset // 20 + 1:03}.sql"
        path.write_text(
            f"insert into public.supplemental_program_catalog ({columns})\n"
            f"select {columns} from jsonb_to_recordset(E'{escaped}'::jsonb) as data({fields})\n"
            "on conflict (catalog_year, program_key) do update set kind=excluded.kind, name=excluded.name, "
            "source_url=excluded.source_url, course_groups=excluded.course_groups, "
            "declaration_groups=excluded.declaration_groups, fetched_at=excluded.fetched_at\n"
            "where supplemental_program_catalog.fetched_at <= excluded.fetched_at;\n", encoding="utf-8",
        )
        batch_files.append(str(path.resolve()))
    parser["write_json"](directory / "supplemental-files.json", batch_files)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("phase", choices=["map", "extract"])
    cli.add_argument("--directory", type=Path, required=True)
    cli.add_argument("--indexes", type=Path)
    cli.add_argument("--years", type=int, nargs="+", default=range(2023, 2027))
    args = cli.parse_args()
    if args.phase == "map":
        if args.indexes is None:
            cli.error("--indexes is required for map")
        map_programs(args.directory, args.indexes, args.years)
    else:
        stage_programs(args.directory)
