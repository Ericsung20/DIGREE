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

## Environment

See `.env.example`. With `DIGREE_MOCK=1` the app runs on mock data, with no optimizer and no database.

The optimizer is called only from server route handlers, never from the browser.
