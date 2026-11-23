"""Index factual UW Guide requirements without treating course references as degree-audit decisions."""

import argparse
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlsplit


GUIDE = "https://guide.wisc.edu"
VOID = set("area base br col embed hr img input link meta param source track wbr".split())
COLLEGES = {
    "College of Agricultural and Life Sciences": "agricultural-life-sciences",
    "College of Engineering": "engineering",
    "College of Letters & Science": "letters-science",
    "School of Business": "business",
    "School of Education": "education",
    "School of Human Ecology": "human-ecology",
    "School of Nursing": "nursing",
    "School of Pharmacy": "pharmacy",
}


def clean(text):
    return " ".join(text.replace("\u200b", "").split())


def label_key(text):
    label = re.sub(r"\b(?:[A-Z]\.){2,}", lambda match: match[0].replace(".", ""), clean(text), flags=re.I)
    return label.casefold().replace("’", "'").replace("–", "-")


class Element:
    def __init__(self, tag, attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def text(self):
        return clean("".join(child.text() if isinstance(child, Element) else child for child in self.children))

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, Element):
                yield from child.walk()

    def classes(self):
        return self.attrs.get("class", "").split()


class Document(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Element("document")
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Element(tag, attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def program_links(html, year):
    prefix = "" if year == 2026 else f"/archive/{year}-{year + 1}"
    links = {}
    for anchor in Document(html).root.walk():
        href = anchor.attrs.get("href", "")
        path = urlsplit(urljoin(GUIDE, href))
        if anchor.tag != "a" or path.netloc != "guide.wisc.edu" or path.fragment or path.query:
            continue
        if not path.path.startswith(prefix + "/undergraduate/"):
            continue
        if len(path.path.removeprefix(prefix).strip("/").split("/")) < 3 or path.path.endswith(".pdf"):
            continue
        labels = {label_key(child.text()) for child in anchor.walk() if child.tag == "h3"} or {label_key(anchor.text())}
        for label in labels - {""}:
            links.setdefault(label, set()).add(path.path.removesuffix("/index.html").rstrip("/") + "/")
    return links


def match_programs(directory):
    programs = load_json(directory / "programs.json")["rows"]
    years = {entry["catalog_year"] for entry in programs}
    by_year = {
        year: program_links((directory / f"index-{year}.html").read_text(encoding="utf-8"), year)
        for year in years
    }
    found, missing = [], []
    for program in programs:
        year = program["catalog_year"]
        prefix = "" if year == 2026 else f"/archive/{year}-{year + 1}"
        slug = COLLEGES.get(program["college"])
        options = by_year[year].get(label_key(program["label"]), set())
        paths = sorted(path for path in options if path.startswith(f"{prefix}/undergraduate/{slug}/"))
        if len(paths) == 1:
            found.append({**program, "url": GUIDE + paths[0]})
        else:
            missing.append({**program, "candidate_paths": sorted(options)})
    write_json(directory / "mapped.json", found)
    write_json(directory / "unmapped.json", missing)
    print(json.dumps({"mapped": len(found), "unmapped": len(missing)}))


def course_references(node):
    references = {}
    for item in node.walk():
        if item.tag != "a" or "bubblelink" not in item.classes():
            continue
        parsed = urlsplit(item.attrs.get("href", ""))
        code = clean(parse_qs(parsed.query).get("P", [""])[0])
        if re.fullmatch(r"[A-Z][A-Z &/-]* \d{3}[A-Z]?", code):
            references[code] = {"code": code, "published_code": item.text() or code}
    return list(references.values())


def table_rows(table):
    course_list = "sc_courselist" in table.classes()
    rows = []
    for row in (node for node in table.walk() if node.tag == "tr"):
        cells = [node for node in row.children if isinstance(node, Element) and node.tag in {"td", "th"}]
        if not cells or not any(cell.text() for cell in cells):
            continue
        credits = next((cell.text() for cell in cells if "hourscol" in cell.classes()), "")
        refs = course_references(row)
        code_cells = [cell for cell in cells if "codecol" in cell.classes()]
        ids = list({ref["code"]: ref for cell in code_cells for ref in course_references(cell)}.values())
        first = cells[0].text()
        if course_list and ids:
            alternative = "orclass" in cells[0].classes() or first.lower().startswith("or ")
            details = " ".join(cell.text() for cell in cells if cell not in code_cells and "hourscol" not in cell.classes())
            rows.append({"kind": "alternative" if alternative else "course", "courses": ids,
                         "credits": credits or None, "description": details,
                         "references": [ref for ref in refs if ref not in ids]})
        elif any(cell.tag == "td" for cell in cells):
            body = " ".join(cell.text() for cell in cells)
            details = " ".join(cell.text() for cell in cells[1:] if "hourscol" not in cell.classes())
            rows.append({"kind": "criterion", "label": first, "description": details, "credits": credits or None,
                         "credit_conditions": credit_conditions(body), "courses": refs})
    return rows


def credit_conditions(text):
    return list(dict.fromkeys(re.findall(r"\b\d+(?:\s*[-–]\s*\d+)?\s+(?:credits?|courses?)\b", text, re.I)))


def extract_requirements(html, *, include_conditions=False, section_id="requirementstextcontainer"):
    root = Document(html).root
    title = next((item.text().split(" < University of Wisconsin")[0] for item in root.walk() if item.tag == "title"), "")
    content = next((item for item in root.walk() if item.attrs.get("id") == section_id), None)
    if content is None:
        return title, None
    headings = {}
    groups = []

    def visit(node):
        if node.tag in {"h2", "h3", "h4", "h5", "h6"}:
            level = int(node.tag[1])
            for old in list(headings):
                if old >= level:
                    del headings[old]
            headings[level] = node.text()
            return
        if "onthispage" in node.classes() or node.tag in {"script", "style"}:
            return
        if node.tag == "table":
            rows = table_rows(node)
            if rows:
                groups.append({
                    "heading": " / ".join(headings.values()) or "Requirements",
                    "rows": rows,
                })
            return
        if node.tag in {"p", "li", "dd"}:
            if include_conditions:
                # Preserve prose rules such as minimum GPA, residency, approvals, and credit overlap.
                # Nested list items are independent rules and keep their own rows.
                nested = [child for child in node.children if isinstance(child, Element) and child.tag in {"p", "ul", "ol", "dl", "table"}]
                inline = Element(node.tag)
                inline.children = [child for child in node.children if child not in nested]
                if label := inline.text():
                    groups.append({
                        "heading": " / ".join(headings.values()) or "Requirements",
                        "rows": [{"kind": "condition", "label": label, "courses": course_references(inline),
                                  "credit_conditions": credit_conditions(label)}],
                    })
                for child in nested:
                    visit(child)
                return
            refs = course_references(node)
            conditions = credit_conditions(node.text())
            if refs or conditions:
                groups.append({
                    "heading": " / ".join(headings.values()) or "Requirements",
                    "rows": [{"kind": "reference", "courses": refs, "credit_conditions": conditions}],
                })
            return
        for child in node.children:
            if isinstance(child, Element):
                visit(child)

    visit(content)
    if include_conditions:
        # Tables and prose under the same section remain one readable section.
        merged = []
        for group in groups:
            if merged and merged[-1]["heading"] == group["heading"]:
                merged[-1]["rows"].extend(group["rows"])
            else:
                merged.append(group)
        groups = merged
    return title, groups


def stage_requirements(directory):
    programs = load_json(directory / "mapped.json")
    inputs = []
    issues = []
    captured = datetime.now(timezone.utc).isoformat()
    for program in programs:
        item = directory / "pages" / (program["id"] + ".html")
        if not item.exists():
            issues.append({**program, "issue": "page unavailable"})
            continue
        title, groups = extract_requirements(item.read_text(encoding="utf-8"), include_conditions=True)
        if label_key(title) != label_key(program["label"]) or not groups:
            issues.append({**program, "issue": "title mismatch or empty requirements", "actual": title})
            continue
        inputs.append({
            "program_id": program["id"],
            "source_url": program["url"] + "#requirementstext",
            "extraction_method": "guide_html",
            "course_groups": groups,
            "fetched_at": captured,
        })
    write_json(directory / "extraction-issues.json", issues)
    files = []
    batch, size = [], 0

    def write_batch(records):
        json_text = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
        escaped = json_text.replace("\\", "\\\\").replace("'", "''")
        path = directory / f"requirements-{len(files) + 1:03d}.sql"
        path.write_text(
            "insert into public.program_requirement_catalog "
            "(program_id, source_url, extraction_method, course_groups, fetched_at)\n"
            "select program_id, source_url, extraction_method, course_groups, fetched_at\n"
            f"from jsonb_to_recordset(E'{escaped}'::jsonb) as data("
            "program_id uuid, source_url text, extraction_method text, course_groups jsonb, fetched_at timestamptz)\n"
            "on conflict (program_id) do update set source_url=excluded.source_url, "
            "extraction_method=excluded.extraction_method, course_groups=excluded.course_groups, fetched_at=excluded.fetched_at\n"
            "where program_requirement_catalog.fetched_at <= excluded.fetched_at;\n",
            encoding="utf-8",
        )
        files.append(str(path.resolve()))

    for record in inputs:
        row_size = len(json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        if batch and size + row_size > 450_000:
            write_batch(batch)
            batch, size = [], 0
        batch.append(record)
        size += row_size
    if batch:
        write_batch(batch)
    write_json(directory / "program-requirement-files.json", files)
    print(json.dumps({"staged": len(inputs), "issues": len(issues), "batches": len(files)}))


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("phase", choices=["map", "extract"])
    cli.add_argument("--directory", type=Path, default=Path(__file__).parent / ".temp" / "program-guides")
    args = cli.parse_args()
    (match_programs if args.phase == "map" else stage_requirements)(args.directory)
