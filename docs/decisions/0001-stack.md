# 0001 — Tech stack (PROPOSED, pending team approval)

Date: 2026-11-14

- Web: Next.js + TypeScript (`apps/web`), server routes act as BFF.
- DB/Auth/Realtime: Supabase (PostgreSQL + RLS), migrations in `supabase/migrations`.
- Optimizer: Python 3.12 + FastAPI (`apps/optimizer`), owned by the algorithm team.
- Contract: `contracts/openapi.yaml` v1.0 — locked; changes need both owners' approval.

Open items: demo term (fixture uses `2027SP`), first 2-3 supported majors, Supabase local (CLI) vs cloud.
