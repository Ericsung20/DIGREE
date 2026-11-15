# DIGREE web

Next.js (App Router) + TypeScript + Tailwind CSS. Mobile-first, 375px baseline.

## Run

```bash
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Web unit and optimizer integration tests |

## Environment

See `.env.example` for the independent settings:

| Data source | Optimizer | DIG behavior |
| --- | --- | --- |
| `NEXT_PUBLIC_DIGREE_DATA=mock` | `DIGREE_MOCK=1` | Sample schedule, saved in the browser |
| `NEXT_PUBLIC_DIGREE_DATA=mock` | `DIGREE_MOCK=0` | Shared fixture sent to the configured optimizer |
| `NEXT_PUBLIC_DIGREE_DATA=supabase` | `DIGREE_MOCK=0` | Signed-in user’s planned courses sent to the optimizer; selected schedule saved to Supabase |
| `NEXT_PUBLIC_DIGREE_DATA=supabase` | `DIGREE_MOCK=1` | Sample schedule preview while other screens use Supabase |

For live DIG, start the optimizer, sign in, add courses with status **Planned** in Profile, then select that term in DIG. If the Supabase project has no academic programs, users can go straight to Schedule. Self-reported enrollment and course chat require a term marked current in Supabase.
