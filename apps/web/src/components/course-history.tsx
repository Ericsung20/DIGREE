'use client';

import {useEffect, useRef, useState} from 'react';
import {field, primary} from '@/components/screen';
import {COURSES, currentTermOf, getBundles, searchCourses, useTerms, type Bundle, type CourseHit} from '@/lib/data/catalog';
import {STATUS_LABEL, addCourseRecord, changeCourseSection, removeCourseRecord, useCourseRecords, type CourseRecord, type CourseRecordStatus} from '@/lib/data/course-records';

const BADGE: Record<CourseRecordStatus, string> = {
  completed: 'bg-neutral-100 text-neutral-900',
  enrolled_self_reported: 'bg-amber-100 text-amber-900',
  planned: 'bg-sky-100 text-sky-900',
  withdrawn: 'bg-neutral-100 text-neutral-600',
};

/** Add and remove course records per term. Used in onboarding and Profile. */
export function CourseHistory({planTerm, initialTerm, onlyTerm = false, initialCourse}: {planTerm?: string; initialTerm?: string; onlyTerm?: boolean; initialCourse?: string} = {}) {
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

  const term = pickedTerm || terms.find((t) => t.id === (planTerm ?? initialTerm))?.id || currentTerm || terms.at(-1)?.id || '';
  // Self-reported enrollment only exists for the current term.
  const historical = currentTerm !== null && terms.findIndex((item) => item.id === term) < terms.findIndex((item) => item.id === currentTerm);
  const statuses: CourseRecordStatus[] = term === currentTerm ? ['enrolled_self_reported', 'planned', 'completed'] : historical ? ['completed', 'planned'] : ['planned', 'completed'];
  const st = statuses.includes(status) ? status : statuses[0];
  const course = hits.find((c) => c.code.toLowerCase() === code.trim().toLowerCase());
  const canChooseSection = !!course && (st === 'enrolled_self_reported' || st === 'completed');
  const chosenBundle = bundles.find((b) => b.bundle_id === bundle);
  const defaultBundle = st === 'enrolled_self_reported' ? bundles[0] : undefined;
  const bundleId = canChooseSection ? (chosenBundle ?? defaultBundle)?.bundle_id ?? null : null;

  async function lookUp(nextCode: string, nextTerm: string) {
    const ticket = ++latest.current;
    setHits([]);
    setBundles([]);
    setBundle('');
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
        className="surface space-y-4"
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
            latest.current++;
            setCode('');
            setHits([]);
            setBundles([]);
            setBundle('');
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
        {st === 'enrolled_self_reported' && (
          <p className="text-xs text-neutral-600">Use this for current courses you enter yourself.</p>
        )}
        {canChooseSection &&
          (bundles.length > 0 ? (
            <label className="block text-xs text-neutral-600">
              Section
              <select name="section" value={bundleId ?? ''} onChange={(e) => setBundle(e.target.value)} className={field}>
                {st === 'completed' && <option value="">Unknown section</option>}
                {bundles.map((b) => (
                  <option key={b.bundle_id} value={b.bundle_id}>
                    {b.label} · {b.summary}
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
        .filter((t) => (!onlyTerm || t.id === term) && records.some((r) => r.term === t.id))
        .map((t) => (
          <section key={t.id} className="surface mt-3">
            <h3 className="section-title">{t.label}</h3>
            <ul>
              {records
                .filter((r) => r.term === t.id)
                .map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 py-2.5 last:border-0 last:pb-0">
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
                    {(r.status === 'completed' || (t.id === currentTerm && r.status === 'enrolled_self_reported')) && (
                      <SectionEditor record={r} expanded={initialCourse === r.course_id} />
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function SectionEditor({record, expanded}: {record: CourseRecord; expanded: boolean}) {
  const [open, setOpen] = useState(expanded);
  const [sections, setSections] = useState<Bundle[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    getBundles(record.course_id, record.term).then((bundles) => {
      if (active) setSections(bundles);
    }).catch(() => {if (active) setError('Couldn’t load sections.');});
    return () => {active = false;};
  }, [open, record.course_id, record.term]);
  return (
    <div className="w-full">
      <button type="button" aria-expanded={open} className="text-sm font-extrabold text-accent" onClick={() => setOpen(!open)}>Change section</button>
      {open && sections?.length ? (
        <select aria-label="Change section" className={field} value={record.bundle_id ?? ''} disabled={busy} onChange={async (event) => {
          setBusy(true);
          try {setError(await changeCourseSection(record.id, event.target.value || null));}
          catch {setError('Couldn’t save the section.');}
          finally {setBusy(false);}
        }}>
          <option value="" disabled={record.status !== 'completed'}>{record.status === 'completed' ? 'Unknown section' : 'Select a section'}</option>
          {sections.map((section) => <option key={section.bundle_id} value={section.bundle_id}>{section.label} · {section.summary}</option>)}
        </select>
      ) : open && !error && <p role="status" className="mt-1 text-xs text-neutral-600">{sections ? 'Sections are unavailable for this course.' : 'Loading sections…'}</p>}
      {open && error && <p role="alert" className="mt-1 text-xs text-accent">{error}</p>}
    </div>
  );
}
