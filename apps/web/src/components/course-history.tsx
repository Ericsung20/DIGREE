'use client';

import {useRef, useState} from 'react';
import {field, primary} from '@/components/screen';
import {COURSES, currentTermOf, getBundles, searchCourses, useTerms, type Bundle, type CourseHit} from '@/lib/data/catalog';
import {STATUS_LABEL, addCourseRecord, removeCourseRecord, useCourseRecords, type CourseRecordStatus} from '@/lib/data/course-records';

const BADGE: Record<CourseRecordStatus, string> = {
  completed: 'bg-neutral-100 text-neutral-900',
  enrolled_self_reported: 'bg-amber-100 text-amber-900',
  planned: 'bg-sky-100 text-sky-900',
  withdrawn: 'bg-neutral-100 text-neutral-600',
};

/** Add and remove course records per term. Used in onboarding and Profile. */
export function CourseHistory({planTerm}: {planTerm?: string} = {}) {
  const records = useCourseRecords();
  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const [pickedTerm, setPickedTerm] = useState('');
  const [code, setCode] = useState('');
  const [hits, setHits] = useState<CourseHit[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [status, setStatus] = useState<CourseRecordStatus>(planTerm ? 'planned' : 'enrolled_self_reported');
  const [bundle, setBundle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0); // drops answers to searches the user has already typed past

  const term = pickedTerm || terms.find((t) => t.id === planTerm)?.id || currentTerm || terms.at(-1)?.id || '';
  // Self-reported enrollment only exists for the current term.
  const statuses: CourseRecordStatus[] = term === currentTerm ? ['enrolled_self_reported', 'planned', 'completed'] : ['planned', 'completed'];
  const st = statuses.includes(status) ? status : statuses[0];
  const course = hits.find((c) => c.code.toLowerCase() === code.trim().toLowerCase());
  const needsSection = st === 'enrolled_self_reported' && !!course;
  const bundleId = needsSection ? (bundles.find((b) => b.bundle_id === bundle) ?? bundles[0])?.bundle_id ?? null : null;

  async function lookUp(nextCode: string, nextTerm: string) {
    const ticket = ++latest.current;
    try {
      const found = await searchCourses(nextCode);
      if (ticket !== latest.current) return;
      setHits(found);
      const match = found.find((c) => c.code.toLowerCase() === nextCode.trim().toLowerCase());
      const sections = match && nextTerm ? await getBundles(match.id, nextTerm) : [];
      if (ticket === latest.current) setBundles(sections);
    } catch {
      if (ticket === latest.current) setError("Couldn't load courses. Check your connection and try again.");
    }
  }

  return (
    <div>
      <form
        className="space-y-3 rounded-xl border border-neutral-200 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!term) return setError('No term is available yet.');
          if (!course) return setError('Pick a course from the list.');
          setBusy(true);
          const err = await addCourseRecord({term, course_id: course.id, course_code: course.code, credits: course.credit_options[0], status: st, bundle_id: bundleId, counts_toward_major: false, source: 'manual'}, currentTerm);
          setBusy(false);
          setError(err);
          if (!err) {
            setCode('');
            setBundles([]);
          }
        }}
      >
        <label className="block text-xs text-neutral-600">
          Term
          <select
            name="term"
            value={term}
            onChange={(e) => {
              setPickedTerm(e.target.value);
              lookUp(code, e.target.value);
            }}
            className={field}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.is_current ? ' · current' : ''}
              </option>
            ))}
          </select>
        </label>
        {terms.length > 0 && currentTerm === null && <p className="text-xs text-neutral-600">No term is marked current yet, so courses can be added as planned or completed only.</p>}
        <label className="block text-xs text-neutral-600">
          Course
          <input
            name="course"
            list="course-options"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
              lookUp(e.target.value, term);
            }}
            placeholder="COMP SCI 400"
            autoComplete="off"
            className={field}
          />
          <datalist id="course-options">
            {hits.map((c) => (
              <option key={c.id} value={c.code}>
                {c.title ?? ''}
              </option>
            ))}
          </datalist>
        </label>
        <label className="block text-xs text-neutral-600">
          Status
          <select name="status" value={st} onChange={(e) => setStatus(e.target.value as CourseRecordStatus)} className={field}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {needsSection &&
          (bundles.length > 0 ? (
            <label className="block text-xs text-neutral-600">
              Section
              <select name="section" value={bundleId ?? ''} onChange={(e) => setBundle(e.target.value)} className={field}>
                {bundles.map((b) => (
                  <option key={b.bundle_id} value={b.bundle_id}>
                    {b.bundle_id} · {b.summary}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs text-neutral-600">No section data for this course. Meeting times stay unknown.</p>
          ))}
        {error && (
          <p role="alert" className="text-xs text-accent">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={`${primary} py-2.5`}>
          {busy ? 'Saving…' : 'Add course'}
        </button>
      </form>

      {records.length === 0 && <p className="py-8 text-center text-sm text-neutral-600">No courses yet. Add past and current courses above.</p>}
      {[...terms]
        .reverse()
        .filter((t) => records.some((r) => r.term === t.id))
        .map((t) => (
          <section key={t.id} className="mt-4">
            <h3 className="text-sm font-semibold">{t.label}</h3>
            <ul>
              {records
                .filter((r) => r.term === t.id)
                .map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 border-b border-neutral-200 py-2.5">
                    <div>
                      <p className="text-sm font-semibold">
                        {r.course_code ?? COURSES.find((c) => c.id === r.course_id)?.code ?? r.course_id}
                        <span className="font-normal text-neutral-600">
                          {' '}
                          · {r.credits} cr{r.bundle_id ? ` · ${r.bundle_id}` : ''}
                        </span>
                      </p>
                      <span className={`mt-1 inline-block rounded-md px-2 py-0.5 text-xs ${BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    </div>
                    <button type="button" onClick={() => removeCourseRecord(r.id)} className="text-sm text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
