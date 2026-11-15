'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useRef, useState, useTransition} from 'react';
import {DigMark} from '@/components/brand';
import {Chevron, Screen, field, primary, secondary} from '@/components/screen';
import {WeeklyTimetable} from '@/components/weekly-timetable';
import {bundleKey, useBundlesFor} from '@/lib/data/catalog';
import {savePlannedSchedule} from '@/lib/data/saved-schedules';
import type {DigDefaults} from '@/lib/dig-request';
import type {GenerateResponse, ScheduleResult} from '@/lib/optimizer';
import {DAYS, minToLabel} from '@/lib/time';
import type {ReactNode} from 'react';

type State = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'saved';
type ErrorKind = 'validation' | 'unavailable' | 'network';

const ERROR_COPY: Record<ErrorKind, [string, string]> = {
  validation: ['Check your inputs', 'The optimizer rejected this request. Review credits and courses, then try again.'],
  unavailable: ['Optimizer is unavailable', "It can't run right now. Try again in a moment."],
  network: ['Connection problem', "We couldn't reach the server. Check your connection and retry."],
};

const NO_RESULTS: Record<string, string> = {
  credits_out_of_range: 'Available combinations fall outside your credit range.',
  section_full: 'A required section is full.',
  outside_time_window: 'Some meetings fall outside your time window.',
  blocked_day: 'Some meetings fall on your days off.',
  time_overlap: 'Some required meetings overlap.',
  insufficient_walk_time: 'There is too little time to walk between some meetings.',
  walk_exceeds_max: 'Some walks are longer than the limit.',
  required_course_ineligible: 'A required course is marked ineligible.',
  required_course_already_completed: 'You already completed a required course that cannot be repeated.',
  required_course_without_bundles: 'A required course has no schedulable sections for this term.',
  no_usable_optional_courses: 'None of the optional courses can be added with these filters.',
  search_truncated: 'The optimizer reached its search limit. Try fewer courses.',
};

const hours = (from: number, to: number) => Array.from({length: to - from + 1}, (_, i) => (from + i) * 60);

function Message({title, body, children}: {title: string; body: React.ReactNode; children?: React.ReactNode}) {
  return (
    <div className="surface px-5 py-10 text-center">
      <p className="section-title">{title}</p>
      <div className="mt-1 text-sm text-neutral-600">{body}</div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

function ResultSummary({result, required, action}: {result: ScheduleResult; required: string[]; action?: ReactNode}) {
  const review = result.status === 'needs_review';
  const unverified = result.warnings.some((warning) => /^(walking_time_unknown|building_unknown|location_uncertain):/.test(warning));
  const added = result.selected.filter((entry) => !required.includes(entry.course_id));
  return (
    <section className="surface space-y-2">
      <div className="flex min-h-12 w-full flex-wrap items-center justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-xs font-extrabold text-neutral-600">Option {result.rank} · Score {result.score.toFixed(2)}</span>
          <span className="text-3xl font-black leading-tight">{result.metrics.total_credits} <span className="text-sm font-extrabold text-neutral-600">cr</span></span>
        </span>
        <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${review ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>{review ? 'Needs review' : 'Ready'}</span>
      </div>
      <p className="text-sm font-bold text-neutral-600">
        {unverified ? 'Walking time unverified' : `${result.metrics.walking_minutes_weekly} min walking per week`}
      </p>
      {added.length > 0 && <p className="text-sm">Automatically added: {added.map((entry) => entry.course_code).join(', ')}</p>}
      {review && <p className="rounded-xl bg-amber-100 px-3 py-2 text-xs text-amber-900">Check availability and eligibility before registering.</p>}
      {action}
    </section>
  );
}

export function DigClient({defaults, canSave, mock}: {defaults: DigDefaults; canSave: boolean; mock?: string}) {
  const router = useRouter();
  const [switchingTerm, startTransition] = useTransition();
  const [state, setState] = useState<State>('idle');
  const [data, setData] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<ErrorKind>('network');
  const [open, setOpen] = useState<number | null>(null);
  const [required, setRequired] = useState<string[]>([]);

  // A ref, not state: two clicks in the same tick both see stale state, but share the ref.
  const busy = useRef(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  async function generate(form: FormData) {
    if (busy.current) return;
    busy.current = true;
    const inputs = {
      term: defaults.term,
      min_credits: form.get('min_credits'),
      max_credits: form.get('max_credits'),
      required: form.getAll('required'),
      earliest: form.get('earliest'),
      latest: form.get('latest'),
      blocked: form.getAll('blocked'),
      preference: form.get('preference') ?? 'balanced',
      related: form.has('related'),
    };
    setRequired(inputs.required.map(String));
    setState('loading');
    try {
      return await request(inputs);
    } finally {
      busy.current = false;
    }
  }

  async function request(inputs: object) {
    setDetail(null);
    try {
      const res = await fetch(`/api/dig/generate${mock ? `?mock=${encodeURIComponent(mock)}` : ''}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(inputs),
      });
      if (res.ok) {
        const body = (await res.json()) as GenerateResponse;
        setData(body);
        setOpen(null);
        setState(body.results.length > 0 ? 'success' : 'empty');
        return;
      }
      setError(res.status === 422 ? 'validation' : res.status === 503 ? 'unavailable' : 'network');
      // A 422 says what to fix (ours or the optimizer's), so show it.
      if (res.status === 422) setDetail(((await res.json().catch(() => null)) as {error?: {message?: string}} | null)?.error?.message ?? null);
    } catch {
      setError('network');
    }
    setState('error');
  }

  async function save(result: ScheduleResult) {
    if (!data || busy.current) return;
    busy.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await savePlannedSchedule({term: data.term, selected: result.selected}, data.request_id);
      setState('saved');
      router.push(`/?term=${encodeURIComponent(data.term)}&view=plans`);
    } catch {
      setSaveError(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const showForm = state === 'idle';
  const preview = state === 'success' && open !== null ? data?.results.find((result) => result.rank === open) : undefined;
  const sections = useBundlesFor((preview?.selected ?? []).map((selection) => ({...selection, term: defaults.term})));
  const addCourses = `/schedule/courses?term=${encodeURIComponent(defaults.term)}&view=plans&from=dig`;
  function step(change: () => void) {
    change();
    window.scrollTo(0, 0);
  }
  return (
    <Screen title={preview ? 'Schedule preview' : showForm ? 'Let’s dig in.' : state === 'saved' ? 'Plan saved' : 'Recommendations'}
      back={showForm ? undefined : preview ? {label: 'Back to recommendations', onClick: () => step(() => setOpen(null))} :
        state === 'loading' || state === 'saved' ? undefined : {label: 'Back to conditions', onClick: () => step(() => setState('idle'))}}>
      {showForm && (
        <div className="mb-4">
          <select aria-label="Term" value={defaults.term} disabled={switchingTerm || defaults.terms.length === 1} onChange={(event) => {
            const term = event.target.value;
            startTransition(() => router.replace(`/dig?term=${encodeURIComponent(term)}`));
          }} className="min-h-11 max-w-full rounded-full bg-neutral-100 px-3.5 py-1.5 text-sm font-extrabold disabled:opacity-75">
            {defaults.terms.map((term) => <option key={term.id} value={term.id}>{term.label}</option>)}
          </select>
        </div>
      )}
      {state === 'success' && data && !preview && (
        <>
          <p className="mb-3 text-sm font-bold text-neutral-600">{defaults.terms.find((term) => term.id === defaults.term)?.label ?? defaults.termLabel}</p>
          <ol className="space-y-3">
            {data.results.map((r, i) => (
              <li key={r.rank}>
                <ResultSummary result={r} required={required} action={<button type="button" className={`${secondary} mt-2 w-full`} onClick={() => step(() => setOpen(r.rank))}>Preview option {i + 1}<Chevron /></button>} />
              </li>
            ))}
          </ol>
          {!defaults.sample && <WalkingCredit />}
          <button type="button" disabled={saving} onClick={() => setState('idle')} className={`${secondary} mt-3 w-full`}>
            Change filters
          </button>
        </>
      )}
      {preview && <>
        <ResultSummary result={preview} required={required} />
        <div className="surface mt-3">
          <WeeklyTimetable items={preview.selected.map((selection) => ({label: selection.course_code, meetings: selection.meetings}))} />
          <ul className="mt-2 divide-y divide-neutral-200">
            {preview.selected.map((selection) => <li className="flex justify-between gap-2 py-2 text-sm" key={selection.course_id}><strong>{selection.course_code}</strong><span>{sections[bundleKey({...selection, term: defaults.term})]?.label ?? selection.bundle_id} · {selection.credits} cr</span></li>)}
          </ul>
        </div>
        {preview.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-600">
          {preview.warnings.map((warning) => <li key={warning}>{warning.replace(/^[a-z_]+: /, '')}</li>)}
        </ul>}
        {!defaults.sample && <WalkingCredit />}
        {canSave && <button className={`${primary} mt-4`} type="button" disabled={saving} onClick={() => void save(preview)}>{saving ? 'Saving…' : 'Save Plan'}</button>}
        {saveError && <p role="alert" className="mt-3 text-sm text-accent">Couldn’t save the schedule. Try again.</p>}
      </>}
      {state === 'empty' && data && (
        <Message
          title="No schedule fits"
          body={
            <>
              {data.diagnostics.no_results_reasons.map((r) => (
                <p key={r}>{NO_RESULTS[r] ?? r}</p>
              ))}
              <p className="mt-2">Try an earlier start, a later end, or fewer days off.</p>
            </>
          }
        >
          <button type="button" onClick={() => setState('idle')} className={secondary}>
            Change filters
          </button>
        </Message>
      )}
      {state === 'error' && (
        <Message title={ERROR_COPY[error][0]} body={detail ?? ERROR_COPY[error][1]}>
          <button type="button" onClick={() => setState('idle')} className={secondary}>
            {error === 'validation' ? 'Edit inputs' : 'Try again'}
          </button>
        </Message>
      )}
      {state === 'saved' && (
        <Message title="Saved as planned" body="This is a plan, not a registration.">
          <Link href={`/?term=${encodeURIComponent(data?.term ?? defaults.term)}&view=plans`} className={secondary}>
            View in Schedule
          </Link>
        </Message>
      )}
      {showForm && defaults.hasSections === false && <Message title="Sections unavailable" body={`Choose a semester with imported section times to build a schedule. ${defaults.termLabel} can still be used in your course history.`} />}
      {showForm && defaults.hasSections !== false && defaults.courses.length === 0 && (
        <Message title="Add planned courses first" body={`DIG builds schedules from the courses you mark as planned for ${defaults.termLabel}.`}>
          <Link href={addCourses} className={secondary}>
            Add courses
          </Link>
        </Message>
      )}

      {state === 'loading' && (
        <div role="status" className="surface mb-4 flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <DigMark className="h-5 w-2 animate-pulse motion-reduce:animate-none" />
          </span>
          <p className="section-title">Digging for schedules…</p>
        </div>
      )}
      {defaults.hasSections !== false && defaults.courses.length > 0 && <form
        hidden={!showForm}
        aria-busy={state === 'loading'}
        onSubmit={(e) => {
          e.preventDefault();
          generate(new FormData(e.currentTarget));
        }}
        className="space-y-4"
      >
        <fieldset disabled={state === 'loading' || switchingTerm} className="min-w-0 space-y-5">
          <div className="surface grid grid-cols-2 gap-3">
            <label className="block flex-1 text-xs text-neutral-600">
              Target credits
              <input name="min_credits" type="number" required min={0} max={40} defaultValue={defaults.minCredits} className={field} />
            </label>
            <label className="block flex-1 text-xs text-neutral-600">
              Maximum credits
              <input name="max_credits" type="number" required min={0} max={40} defaultValue={defaults.maxCredits} className={field} />
            </label>
          </div>
          <fieldset className="min-w-0">
            <legend className="section-title mb-2">Required courses</legend>
            <div className="flex flex-wrap gap-2">
              {defaults.courses.map((c) => (
                <label key={c.id} className="choice-chip cursor-pointer">
                  <input type="checkbox" name="required" value={c.id} defaultChecked={c.required} className="sr-only" />
                  {c.code} · {c.credits} cr
                </label>
              ))}
            </div>
            {!defaults.sample && <Link href={addCourses} className="mt-2 inline-block rounded-full border border-dashed border-neutral-300 px-3.5 py-2 text-sm font-extrabold text-accent">Edit planned courses</Link>}
          </fieldset>
          <div className="surface grid grid-cols-2 gap-3">
            <label className="block flex-1 text-xs text-neutral-600">
              Earliest start
              <select name="earliest" defaultValue={defaults.earliest} className={field}>
                {hours(7, 12).map((m) => (
                  <option key={m} value={m}>
                    {minToLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 text-xs text-neutral-600">
              Latest end
              <select name="latest" defaultValue={defaults.latest} className={field}>
                {hours(13, 22).map((m) => (
                  <option key={m} value={m}>
                    {minToLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="min-w-0">
            <legend className="section-title mb-1">Days off</legend>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-2">
              {DAYS.map((d) => (
                <label key={d} className="choice-chip cursor-pointer">
                  <input type="checkbox" name="blocked" value={d} className="sr-only" />
                  {d[0] + d.slice(1).toLowerCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-extrabold">Scheduling preference
            <select name="preference" className={field} defaultValue="balanced">
              <option value="balanced">Balanced</option>
              <option value="walking">Less walking</option>
              <option value="days">Fewer campus days</option>
            </select>
          </label>
          {!defaults.sample && <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="related" defaultChecked /> Suggest courses in the same subjects if I need more credits
          </label>}
          <button type="submit" className={primary}>
            <DigMark className="h-5 w-2" />
            Generate
          </button>
          <p className="text-xs text-neutral-600">
            {defaults.sample ? 'Sample results use preset filters.' : 'Unchecked courses are optional.'}
          </p>
        </fieldset>
      </form>}
    </Screen>
  );
}

function WalkingCredit() {
  return <p className="mt-3 text-xs text-neutral-600">Walking estimates © <a className="underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></p>;
}
