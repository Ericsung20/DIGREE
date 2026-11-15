'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useRef, useState, useTransition} from 'react';
import {field, primary, secondary} from '@/components/screen';
import {WeeklyTimetable} from '@/components/weekly-timetable';
import {savePlannedSchedule} from '@/lib/data/saved-schedules';
import type {DigDefaults} from '@/lib/dig-request';
import type {GenerateResponse, ScheduleResult} from '@/lib/optimizer';
import {DAYS, minToLabel} from '@/lib/time';

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
    <div className="px-3 py-10 text-center">
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-sm text-neutral-600">{body}</div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

function ResultCard({result, open, onOpen, onSave, saving}: {result: ScheduleResult; open: boolean; onOpen: () => void; onSave?: () => void; saving: boolean}) {
  const review = result.status === 'needs_review';
  return (
    <li className={`rounded-xl border p-3 ${open ? 'border-2 border-accent' : 'border-neutral-200'}`}>
      <button type="button" onClick={onOpen} aria-expanded={open} className="flex w-full items-center justify-between text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <span className="font-semibold">
          #{result.rank} · {result.score.toFixed(2)}
        </span>
        <span className={`rounded-md px-2 py-0.5 text-xs ${review ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>{review ? 'Needs review' : 'Ready'}</span>
      </button>
      <p className="mt-1 text-xs text-neutral-600">
        {result.metrics.total_credits} credits · {result.metrics.walking_minutes_weekly} min walking per week
      </p>
      {review && <p className="mt-2 rounded-lg bg-amber-100 px-2 py-1.5 text-xs text-amber-900">Check availability and eligibility before registering.</p>}
      {result.warnings.map((w) => (
        <p key={w} className="mt-2 rounded-lg bg-amber-100 px-2 py-1.5 text-xs text-amber-900">
          {w.replace(/^[a-z_]+: /, '')}
        </p>
      ))}
      {result.reasons.map((r) => (
        <p key={r} className="mt-2 text-xs text-neutral-600">
          {r}
        </p>
      ))}
      {open && (
        <div className="mt-3">
          <WeeklyTimetable items={result.selected.map((s) => ({label: s.course_code, meetings: s.meetings}))} />
        </div>
      )}
      {onSave && <button type="button" onClick={onSave} disabled={saving} className={`${primary} mt-3 py-2.5`}>
        {saving ? 'Saving…' : 'Save as planned'}
      </button>}
    </li>
  );
}

export function DigClient({defaults, canSave, mock}: {defaults: DigDefaults; canSave: boolean; mock?: string}) {
  const router = useRouter();
  const [switchingTerm, startTransition] = useTransition();
  const [state, setState] = useState<State>('idle');
  const [data, setData] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<ErrorKind>('network');
  const [open, setOpen] = useState(0);

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
    };
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
        setOpen(0);
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
    } catch {
      setSaveError(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const showForm = state === 'idle' || state === 'loading';
  const addCourses = `/profile?planTerm=${encodeURIComponent(defaults.term)}#course-history`;
  return (
    <>
      {showForm && (
        <label className="mb-4 block text-xs text-neutral-600">
          Term
          <select value={defaults.term} disabled={state === 'loading' || switchingTerm || defaults.terms.length === 1} onChange={(event) => {
            const term = event.target.value;
            startTransition(() => router.replace(`/dig?term=${encodeURIComponent(term)}`));
          }} className={field}>
            {defaults.terms.map((term) => <option key={term.id} value={term.id}>{term.label}</option>)}
          </select>
        </label>
      )}
      {state === 'success' && data && (
        <>
          <ol className="space-y-2">
            {data.results.map((r, i) => (
              <ResultCard
                key={r.rank}
                result={r}
                open={i === open}
                onOpen={() => setOpen(i)}
                onSave={canSave && r.selected.length ? () => save(r) : undefined}
                saving={saving}
              />
            ))}
          </ol>
          {saveError && <p role="alert" className="mt-3 text-sm text-accent">Couldn’t save the schedule. Try again.</p>}
          {!defaults.sample && <p className="mt-3 text-xs text-neutral-600">Walking estimates © <a className="underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></p>}
          <button type="button" disabled={saving} onClick={() => setState('idle')} className={`${secondary} mt-3 w-full`}>
            Change filters
          </button>
        </>
      )}
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
          <Link href="/" className={secondary}>
            View in Schedule
          </Link>
        </Message>
      )}
      {showForm && defaults.courses.length === 0 && (
        <Message title="Add planned courses first" body={`DIG builds schedules from the courses you mark as planned for ${defaults.termLabel}.`}>
          <Link href={addCourses} className={secondary}>
            Add courses
          </Link>
        </Message>
      )}

      {defaults.courses.length > 0 && <form
        hidden={!showForm}
        aria-busy={state === 'loading'}
        onSubmit={(e) => {
          e.preventDefault();
          generate(new FormData(e.currentTarget));
        }}
        className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5"
      >
        <fieldset disabled={state === 'loading' || switchingTerm} className="space-y-4">
          <div className="flex gap-2">
            <label className="block flex-1 text-xs text-neutral-600">
              Min credits
              <input name="min_credits" type="number" required min={0} max={40} defaultValue={defaults.minCredits} className={field} />
            </label>
            <label className="block flex-1 text-xs text-neutral-600">
              Max credits
              <input name="max_credits" type="number" required min={0} max={40} defaultValue={defaults.maxCredits} className={field} />
            </label>
          </div>
          <fieldset>
            <legend className="text-xs text-neutral-600">Required courses</legend>
            {defaults.courses.map((c) => (
              <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" name="required" value={c.id} defaultChecked={c.required} />
                {c.code} · {c.credits} cr
              </label>
            ))}
            {!defaults.sample && <Link href={addCourses} className="mt-1 inline-block text-sm font-medium text-accent">Edit planned courses</Link>}
          </fieldset>
          <div className="flex gap-2">
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
          <fieldset>
            <legend className="text-xs text-neutral-600">Days off</legend>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-2">
              {DAYS.map((d) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="blocked" value={d} />
                  {d[0] + d.slice(1).toLowerCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className={primary}>
            {state === 'loading' ? 'Generating…' : 'Generate schedules'}
          </button>
          <p className="text-xs text-neutral-600">
            {defaults.sample ? 'Sample results use preset filters.' : 'Unchecked courses are optional.'}
          </p>
        </fieldset>
      </form>}
    </>
  );
}
