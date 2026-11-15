# DIGREE web

Next.js (App Router) + TypeScript. The screens follow the DIGREE design boards (390 × 844): each page keeps the board's markup, inline styles and stylesheet, so the two can be compared side by side. A phone shows a screen edge to edge; a wider window shows the same screen centered.

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
| `NEXT_PUBLIC_DIGREE_DATA=mock` | `DIGREE_MOCK=0` | Form conditions and synthetic designation courses sent to the configured optimizer |
| `NEXT_PUBLIC_DIGREE_DATA=supabase` | `DIGREE_MOCK=0` | Signed-in user’s planned courses sent to the optimizer; selected schedule saved to Supabase |
| `NEXT_PUBLIC_DIGREE_DATA=supabase` | `DIGREE_MOCK=1` | Sample schedule preview while other screens use Supabase |

For live DIG, start the optimizer, sign in, open DIG, add at least one **Must take** course for the term, then tap **Dig in**. Append `?mock=empty`, `?mock=503`, `?mock=422` or `?mock=network` to `/dig` to preview the empty and error screens when `DIGREE_MOCK=1`. If the Supabase project has no academic programs, users can go straight to Schedule. Self-reported enrollment and course chat require a term marked current in Supabase.

The DIG form offers UW breadth, Communication A/B, Quantitative Reasoning A/B, and Ethnic Studies designations. Selected codes are a union: a course matching any one gets preference; it need not match them all. The posted field remains `preferred_breadths` for optimizer compatibility. In Supabase mode the server gathers matching courses from `courses.breadth` and term-specific `course_designations`, then passes their tags and a preference weight to the optimizer. Import designation rows for the term before testing Comm/QR/Ethnic filters against Supabase. In mock data mode with `DIGREE_MOCK=0`, synthetic courses demonstrate the ranking change. The short-walk, lunch, and fewer-days controls have been removed from the DIG screen.

The DIG form caps target credits at 18. Major courses default to a soft 2–4 preference; "No preference" is neutral, and explicit hard maximums range from 0 to 6. The hard maximum includes must-takes. In Supabase mode a course counts as major when the student's planned record has `counts_toward_major=true` or its canonical/cross-listed code appears in `program_requirement_course_options` for the student's academic program. The optimizer enforces a selected hard maximum across the schedule. Without program course options or explicit flags, the soft preference is skipped; an explicit hard maximum asks the student to set up their program or mark planned courses.

## Screens

| Design board | Route |
| --- | --- |
| My Schedule | `/` (`?term=`, `?view=plans`) |
| Add / Edit Course | `/schedule/add` (`?course=` changes a section, `?for=dig` adds a must-take) |
| Course Detail | `/course/[courseId]` |
| Generate Setup → Recommendations → Schedule Preview | `/dig` → `/dig/results` → `/dig/preview` |
| Log In / Sign Up | `/login` |
| Academic Profile Setup, Course History Setup | `/onboarding`, `/onboarding/courses` |
| Friends, Friend’s Schedule, Sharing Settings | `/friends`, `/friends/[friendId]`, `/friends/sharing` |
| GPA Dashboard, Edit Grades | `/gpa`, `/gpa/grades` |
| Community Feed, Post Detail, New Post | `/community`, `/community/[postId]`, `/community/new` |
| Room List, Chat Room | `/chat`, `/chat/[roomId]` |
| Edit Profile, Degree Requirements | `/profile`, `/profile/requirements` |

Shared pieces live in `src/components/dg.tsx`. `s()` in `src/lib/ui/css.ts` turns a CSS declaration string into a React style object.
