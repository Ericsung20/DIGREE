'use client';

import Link from 'next/link';
import {EmptyState, Screen, secondary} from '@/components/screen';
import {COURSES, useTerms} from '@/lib/data/catalog';
import {setCountsTowardMajor, setGrade, useCourseRecords, useGrades} from '@/lib/data/course-records';
import {LETTER_GRADES, summarize, type LetterGrade} from '@/lib/gpa';

const fmt = (n: number | null) => (n === null ? '—' : n.toFixed(2));

type TermPoint = {term: string; overall: number | null; major: number | null};

/** Overall vs major-only GPA by term. A term with no grades leaves a gap instead of a zero. */
function GpaChart({terms}: {terms: TermPoint[]}) {
  const W = 343, H = 130, L = 22, R = 12, T = 8, B = 22;
  const x = (i: number) => (terms.length < 2 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (terms.length - 1));
  const y = (v: number) => T + (1 - v / 4) * (H - T - B);
  const series = (key: 'overall' | 'major') =>
    terms.flatMap((t, i) => {
      const v = t[key];
      return v === null ? [] : [[x(i), y(v)] as const];
    });
  const draw = (key: 'overall' | 'major', cls: string, dash?: string) => {
    const pts = series(key);
    return (
      <g className={cls}>
        <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={dash} />
        {pts.map(([cx, cy]) => (
          <circle key={cx} cx={cx} cy={cy} r="3" fill="currentColor" />
        ))}
      </g>
    );
  };
  const label = terms.map((t) => `${t.term}: overall ${fmt(t.overall)}, major ${fmt(t.major)}`).join('; ');
  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`GPA by term. ${label}`} className="w-full">
        {[0, 1, 2, 3, 4].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-neutral-200" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" className="fill-neutral-500 text-[9px]">
              {v}
            </text>
          </g>
        ))}
        {terms.map((t, i) => (
          <text key={t.term} x={x(i)} y={H - 6} textAnchor="middle" className="fill-neutral-500 text-[9px]">
            {t.term}
          </text>
        ))}
        {draw('overall', 'text-neutral-900')}
        {draw('major', 'text-accent', '5 3')}
      </svg>
      <figcaption className="text-xs text-neutral-600">
        <span className="font-semibold text-neutral-900">— Overall</span> · <span className="font-semibold text-accent">- - Major only</span> · Terms without grades are left empty.
      </figcaption>
    </figure>
  );
}

export default function GpaPage() {
  const records = useCourseRecords();
  const grades = useGrades();
  const terms = useTerms();
  const rows = records
    .filter((r) => r.status === 'completed' || r.status === 'enrolled_self_reported')
    .map((r) => ({...r, grade: grades[r.id] ?? null, major: r.counts_toward_major}));
  const s = summarize(rows, terms.map((t) => t.id));

  if (rows.length === 0) {
    return (
      <Screen title="GPA">
        <EmptyState title="No grades yet" body="Add completed or current courses, then pick a grade for each." />
        <Link href="/profile" className={`${secondary} block text-center`}>
          Add courses
        </Link>
      </Screen>
    );
  }

  const tiles: [string, string][] = [
    ['Cumulative GPA', fmt(s.cumulative)],
    ['Major GPA', fmt(s.major)],
    ['Credits earned', String(s.creditsEarned)],
    ['Major credits', String(s.majorCredits)],
    ['In progress', String(s.inProgress)],
  ];

  return (
    <Screen title="GPA">
      <dl className="grid grid-cols-3 gap-2">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-neutral-100 p-2">
            <dt className="text-[11px] text-neutral-600">{label}</dt>
            <dd className="text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <GpaChart terms={s.terms} />

      {[...s.terms].reverse().map((t) => (
        <section key={t.term} className="mt-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {terms.find((x) => x.id === t.term)?.label ?? t.term} · {fmt(t.overall)}
            {t.projected && <span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-normal text-sky-900">Projected</span>}
          </h2>
          <ul>
            {rows
              .filter((r) => r.term === t.term)
              .map((r) => {
                const code = r.course_code ?? COURSES.find((c) => c.id === r.course_id)?.code ?? r.course_id;
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2 border-b border-neutral-200 py-2 text-sm">
                    <span>
                      <span className="font-semibold">{code}</span>
                      <span className="text-neutral-600"> · {r.credits} cr</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={r.major} onChange={(e) => setCountsTowardMajor(r.id, e.target.checked)} />
                        Major
                      </label>
                      <select
                        aria-label={`Grade for ${code}`}
                        value={r.grade ?? ''}
                        onChange={(e) => setGrade(r.id, (e.target.value || null) as LetterGrade | null, r.status === 'completed')}
                        className="rounded-lg border border-neutral-300 bg-white px-1.5 py-1 text-sm"
                      >
                        <option value="">Grade</option>
                        {LETTER_GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      <p className="mt-4 text-xs text-neutral-600">
        Grades are entered by you and stay private. Current-term grades are projections and are left out of the cumulative GPA. Pass/fail, incomplete and repeated courses aren&apos;t counted yet.
      </p>
    </Screen>
  );
}
