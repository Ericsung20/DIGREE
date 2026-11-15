# DIGREE

DIGREE helps UW–Madison students plan class schedules. The web app reads course and schedule data from Supabase and sends normalized requests to the scheduling optimizer.

| Component | Setup |
| --- | --- |
| Next.js web app | [Web README](apps/web/README.md) |
| FastAPI optimizer | [Optimizer README](apps/optimizer/README.md) |
| Supabase schema, seed data, and imports | [Database README](supabase/README.md) |

## Local development

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
- [Team handoff](docs/handoffs/START_HERE.md) describes the original MVP scope and ownership.
