'use client';

import Link from 'next/link';
import {useState} from 'react';
import {EmptyState, Screen, field, primary, secondary} from '@/components/screen';
import {COURSES, currentTermOf, useTerms} from '@/lib/data/catalog';
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
    <figure className="surface mt-3">
      <h2 className="section-title mb-3">By semester</h2>
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
        {draw('major', 'text-sky-900', '5 3')}
      </svg>
      <figcaption className="text-xs text-neutral-600">
        <span className="font-extrabold text-neutral-900">— Overall</span> · <span className="font-extrabold text-sky-900">- - Major only</span> · Terms without grades are left empty.
      </figcaption>
    </figure>
  );
}

export function GpaDashboard({editing = false, initialTerm}: {editing?: boolean; initialTerm?: string}) {
  const records = useCourseRecords();
  const grades = useGrades();
  const terms = useTerms();
  const rows = records
    .filter((r) => r.status === 'completed' || r.status === 'enrolled_self_reported')
    .map((r) => ({...r, grade: grades[r.id] ?? null, major: r.counts_toward_major}));
  const s = summarize(rows, terms.map((t) => t.id));
  const [picked, pick] = useState(initialTerm);
  const semester = terms.find((t) => t.id === picked)?.id ?? currentTermOf(terms) ?? s.terms.at(-1)?.term ?? '';
  const termName = (id: string) => terms.find((t) => t.id === id)?.label ?? id;
  const term = s.terms.find((t) => t.term === semester);
  const back = {href: `/gpa?term=${encodeURIComponent(semester)}`, label: 'Back to GPA'};
  const semesterPicker = <label className="block text-sm font-extrabold">Semester
    <select className={field} value={semester} onChange={(event) => pick(event.target.value)} disabled={!terms.length}>
      {!terms.length && <option value="">Loading semesters…</option>}
      {[...terms].reverse().map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  </label>;

  if (rows.length === 0) {
    return (
      <Screen title={editing ? 'Edit grades' : 'GPA'} back={editing ? back : undefined}>
        <EmptyState title="No grades yet" body="Add completed or current courses, then pick a grade for each." />
        <Link href="/profile" className={`${secondary} w-full`}>
          Add courses
        </Link>
      </Screen>
    );
  }

  const tiles: [string, string][] = [
    ['Major GPA', fmt(s.major)],
    ['Credits earned', String(s.creditsEarned)],
    ['Major credits', String(s.majorCredits)],
    ['In progress', String(s.inProgress)],
  ];

  return (
    <Screen title={editing ? 'Edit grades' : 'GPA'} back={editing ? back : undefined}>
      {!editing && <>
      <dl className="surface grid grid-cols-2 gap-2 rounded-[28px] p-5 shadow-raised">
        <div className="col-span-2 mb-2">
          <dt className="text-sm font-extrabold text-neutral-600">Cumulative GPA</dt>
          <dd className="text-[4rem] leading-none font-black tracking-[-0.04em]">{fmt(s.cumulative)}</dd>
        </div>
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-canvas px-3 py-2.5">
            <dt className="text-xs font-extrabold text-neutral-600">{label}</dt>
            <dd className="text-xl font-black">{value}</dd>
          </div>
        ))}
      </dl>
      <GpaChart terms={s.terms.map((item) => ({...item, term: termName(item.term).replace(/^(Spring|Summer|Fall) (\d{2})(\d{2}).*$/, (_, season: string, _century: string, year: string) => `${season.slice(0, 2)} ${year}`)}))} />
      </>}

      <div className="mt-4">{semesterPicker}</div>
      {!term && <div className="mt-3"><EmptyState title="No courses for this semester" body="Add completed or current courses to enter grades." /></div>}
      {term && [term].map((t) => (
        <section key={t.term} className="surface mt-3">
          <h2 className="section-title flex flex-wrap items-center gap-2">
            {termName(t.term)} · {fmt(t.overall)}
            {t.projected && <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-extrabold text-sky-900">Projected</span>}
          </h2>
          <ul>
            {rows
              .filter((r) => r.term === t.term)
              .map((r) => {
                const code = r.course_code ?? COURSES.find((c) => c.id === r.course_id)?.code ?? r.course_id;
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-neutral-200 py-2 text-sm last:border-0 last:pb-0">
                    <span className="min-w-0 wrap-anywhere">
                      <span className="font-semibold">{code}</span>
                      <span className="text-neutral-600"> · {r.credits} cr</span>
                    </span>
                    {editing ? <span className="flex items-center gap-3">
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={r.major} onChange={(e) => setCountsTowardMajor(r.id, e.target.checked)} />
                        Major
                      </label>
                      <select
                        aria-label={`Grade for ${code}`}
                        value={r.grade ?? ''}
                        onChange={(e) => setGrade(r.id, (e.target.value || null) as LetterGrade | null, r.status === 'completed')}
                        className="min-h-10 rounded-xl bg-neutral-100 px-2 py-1 text-sm font-extrabold"
                      >
                        <option value="">Grade</option>
                        {LETTER_GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </span> : <span className="font-extrabold">{r.grade ?? '—'}</span>}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      {!editing && term && <Link className={`${primary} mt-3`} href={`/gpa/grades?term=${encodeURIComponent(semester)}`}>Edit grades</Link>}
      <p className="mt-4 text-xs text-neutral-600">
        Grades are entered by you and stay private. Current-term grades are projections and are left out of the cumulative GPA. Pass/fail, incomplete and repeated courses aren&apos;t counted yet.
      </p>
    </Screen>
  );
}
