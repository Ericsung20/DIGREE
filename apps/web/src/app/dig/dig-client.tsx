'use client';

import Link from 'next/link';
import {useRef, useState} from 'react';
import {field, primary, secondary} from '@/components/screen';
import {WeeklyTimetable} from '@/components/weekly-timetable';
import {savePlannedSchedule} from '@/lib/data/saved-schedules';
import type {GenerateResponse, ScheduleResult} from '@/lib/optimizer';
import {DAYS, minToLabel} from '@/lib/time';

type State = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'saved';
type ErrorKind = 'validation' | 'unavailable' | 'network';

export type DigDefaults = {
  term: string;
  minCredits: number;
  maxCredits: number;
  earliest: number;
  latest: number;
  courses: {id: string; code: string; credits: number; required: boolean}[];
};

const ERROR_COPY: Record<ErrorKind, [string, string]> = {
  validation: ['Check your inputs', 'The optimizer rejected this request. Review credits and courses, then try again.'],
  unavailable: ['Optimizer is unavailable', "It can't run right now. Try again in a moment."],
  network: ['Connection problem', "We couldn't reach the server. Check your connection and retry."],
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

function ResultCard({result, open, onOpen, onSave}: {result: ScheduleResult; open: boolean; onOpen: () => void; onSave: () => void}) {
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
          {w}
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
      <button type="button" onClick={onSave} className={`${primary} mt-3 py-2.5`}>
        Save as planned
      </button>
    </li>
  );
}

export function DigClient({defaults, mock}: {defaults: DigDefaults; mock?: string}) {
  const [state, setState] = useState<State>('idle');
  const [data, setData] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<ErrorKind>('network');
  const [open, setOpen] = useState(0);

  // A ref, not state: two clicks in the same tick both see stale state, but share the ref.
  const busy = useRef(false);

  async function generate() {
    if (busy.current) return;
    busy.current = true;
    setState('loading');
    try {
      return await request();
    } finally {
      busy.current = false;
    }
  }

  async function request() {
    try {
      const res = await fetch(`/api/dig/generate${mock ? `?mock=${encodeURIComponent(mock)}` : ''}`, {method: 'POST'});
      if (res.ok) {
        const body = (await res.json()) as GenerateResponse;
        setData(body);
        setOpen(0);
        setState(body.results.length > 0 ? 'success' : 'empty');
        return;
      }
      setError(res.status === 422 ? 'validation' : res.status === 503 ? 'unavailable' : 'network');
    } catch {
      setError('network');
    }
    setState('error');
  }

  if (state === 'success' && data) {
    return (
      <>
        <ol className="space-y-2">
          {data.results.map((r, i) => (
            <ResultCard
              key={r.rank}
              result={r}
              open={i === open}
              onOpen={() => setOpen(i)}
              onSave={() => {
                savePlannedSchedule({term: data.term, selected: r.selected});
                setState('saved');
              }}
            />
          ))}
        </ol>
        <button type="button" onClick={() => setState('idle')} className={`${secondary} mt-3 w-full`}>
          Change filters
        </button>
      </>
    );
  }
  if (state === 'empty' && data) {
    return (
      <Message
        title="No schedule fits"
        body={
          <>
            {data.diagnostics.no_results_reasons.map((r) => (
              <p key={r}>{r}</p>
            ))}
            <p className="mt-2">Try an earlier start, a later end, or fewer days off.</p>
          </>
        }
      >
        <button type="button" onClick={() => setState('idle')} className={secondary}>
          Change filters
        </button>
      </Message>
    );
  }
  if (state === 'error') {
    return (
      <Message title={ERROR_COPY[error][0]} body={ERROR_COPY[error][1]}>
        <button type="button" onClick={() => setState('idle')} className={secondary}>
          {error === 'validation' ? 'Edit inputs' : 'Try again'}
        </button>
      </Message>
    );
  }
  if (state === 'saved') {
    return (
      <Message title="Saved as planned" body="This is a plan, not a registration.">
        <Link href="/" className={secondary}>
          View in Schedule
        </Link>
      </Message>
    );
  }

  // idle and loading share the form; loading only disables the button.
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        generate();
      }}
      className="space-y-3"
    >
      <label className="block text-xs text-neutral-600">
        Term
        <select name="term" defaultValue={defaults.term} className={field}>
          <option value={defaults.term}>{defaults.term}</option>
        </select>
      </label>
      <div className="flex gap-2">
        <label className="block flex-1 text-xs text-neutral-600">
          Min credits
          <input name="min_credits" type="number" min={0} max={40} defaultValue={defaults.minCredits} className={field} />
        </label>
        <label className="block flex-1 text-xs text-neutral-600">
          Max credits
          <input name="max_credits" type="number" min={0} max={40} defaultValue={defaults.maxCredits} className={field} />
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
        <div className="mt-1 flex gap-3">
          {DAYS.slice(0, 5).map((d) => (
            <label key={d} className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="blocked" value={d} />
              {d[0] + d.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" disabled={state === 'loading'} className={primary}>
        {state === 'loading' ? 'Generating…' : 'Generate schedules'}
      </button>
      <p className="text-xs text-neutral-600">Mock mode returns the shared sample result, whatever you pick here.</p>
    </form>
  );
}
