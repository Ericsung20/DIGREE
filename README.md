# DIGREE

DIGREE is a schedule-first student planning project. **This repository is an empty project scaffold**, not a working app. No feature implementation, database tables, or optimization logic has been added.

## Folder structure

```text
apps/
  web/                 Full-stack app (Next.js + TypeScript, proposed)
  optimizer/           Independent schedule optimizer (FastAPI + Python, proposed)
contracts/             Shared API specification (OpenAPI)
fixtures/              Shared example API request / expected response
docs/
  handoffs/            Team reference documents
  decisions/           Architecture/team decisions
supabase/
  migrations/          Database migration files (if Supabase is selected)
.github/ISSUE_TEMPLATE/  Future issue templates
```

Empty folders include `.gitkeep` so that Git can track them. Delete that placeholder after adding actual files.

## Which source file goes where?

These files are already in the team's project source materials. Copy them when the team is ready; they are **not** included in this empty scaffold.

| Existing file | Git repository path |
| --- | --- |
| `START_HERE.md` | `docs/handoffs/START_HERE.md` |
| `DIGREE_Fullstack_Handoff.md` | `docs/handoffs/DIGREE_Fullstack_Handoff.md` |
| `DIGREE_Algorithm_Handoff.md` | `docs/handoffs/DIGREE_Algorithm_Handoff.md` |
| `DIGREE_API_CONTRACT_v1.yaml` | `contracts/openapi.yaml` |
| `DIGREE_fixture_request.json` | `fixtures/request.json` |
| `DIGREE_fixture_expected_response.json` | `fixtures/expected.json` |

PDF handoff copies are optional; use Markdown as the editable source.

## First-time setup

```bash
git clone https://github.com/Ericsung20/DIGREE.git
cd DIGREE
```

If you downloaded this scaffold ZIP, copy its **contents** into the local `DIGREE` folder, then run:

```bash
git add .
git commit -m "chore: add project scaffold"
git push origin main
```

## Working with teammates

Create a branch for each task (never develop directly on `main`):

```bash
# Full-stack developer
git switch -c feature/web-task-name

# OR optimizer developer
git switch -c feature/optimizer-task-name
```

After editing files:

```bash
git add .
git commit -m "feat: short description"
git push -u origin YOUR_BRANCH_NAME
```

Open a **Pull Request** from the feature branch to `main`, and merge after review.

## Ownership and shared rules

- `apps/web/`: UI, database, authentication, course data intake/normalization, GPA, schedules, community, chat, friends, and calling the optimizer.
- `apps/optimizer/`: API endpoint, schedule combination search, constraints, scoring, diagnostics, and optimizer tests.
- `contracts/` and `fixtures/`: shared; **both owners review changes**.
- The shared contract v1 specifies `GET /health` and `POST /v1/schedules/generate`. The optimizer receives normalized, anonymized JSON; it does not fetch university data itself.
- Do not create a second optimization algorithm in the web app.
- Do not commit secrets, personal academic records, or original DARS PDFs.
- Tech stack follows the handoff documents as a proposal; agree on it before implementation.

## Suggested first tasks (not implemented)

Full-stack: initialize the app inside `apps/web/`; connect an API adapter using the shared fixtures. Optimizer: initialize the independent FastAPI service inside `apps/optimizer/`; write tests based on the same fixtures. Neither team should independently change API field names or enums.
