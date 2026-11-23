# DIGREE

DIGREE helps UW–Madison students plan class schedules. The web app reads course and schedule data from Supabase and sends normalized requests to the scheduling optimizer.

| Component | Setup |
| --- | --- |
| Next.js web app | [Web README](apps/web/README.md) |
| FastAPI optimizer | [Optimizer README](apps/optimizer/README.md) |
| Supabase schema, seed data, and imports | [Database README](supabase/README.md) |

## Shared development (the team default)

Both developers run the web app and optimizer on their own machines and connect to the same existing DIGREE Supabase project. Docker is not needed for this workflow. Follow [the team setup guide](docs/shared-development.md). Project references and their intended use are recorded in [environments.json](supabase/environments.json); a separate production project will be created before public launch.

```powershell
git clone --branch db_fix https://github.com/Ericsung20/DIGREE.git DIGREE-dev
cd DIGREE-dev/apps/web
npm ci
Copy-Item .env.shared.example .env.local
```

Fill the public client key in `.env.local`, run the optimizer at `http://127.0.0.1:8000` in another terminal, and run `npm run dev` from `apps/web`. Open [localhost:3000](http://localhost:3000). Never use an admin/service-role key in the web environment.

## Isolated regression database

Docker is used for disposable local database tests, not shared team data. From the repository root:

```powershell
powershell -File scripts/dev-db.ps1 start
powershell -File scripts/dev-db.ps1 test
powershell -File scripts/check-dev.ps1
```

This stack uses project ID `DIGREE-dev` and API port `55321`. It does not reset the shared cloud database or an existing local stack. See [the database architecture and rollout notes](docs/database-architecture.md).

## Browser-only preview

For a browser-only preview, install the web dependencies and use the sample environment:

```powershell
cd apps/web
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). The sample environment uses synthetic data and requires no sign-in.

For a full-stack run, start the [local Supabase stack](supabase/README.md) and [optimizer](apps/optimizer/README.md). In the web environment, set `NEXT_PUBLIC_DIGREE_DATA=supabase`, `DIGREE_MOCK=0`, the Supabase URL and public client key, and the optimizer URL. Save credentials and local configuration in the ignored `apps/web/.env.local`.

## Shared interfaces

- [OpenAPI contract](contracts/openapi.yaml) and [reference fixtures](fixtures/) define the web-to-optimizer API. Both owners review contract changes.
- [Database handoff](supabase/DB_HANDOFF.md) describes the Supabase interface and access policies.
- [Scenario testing](docs/scenario-testing.md) maps the DIGREE design boards to app flows and data checks.
- [Team handoff](docs/handoffs/START_HERE.md) describes the original MVP scope and ownership.
