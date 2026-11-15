'use client';

import Link from 'next/link';
import {useRef, useState} from 'react';
import {EmptyState, Screen, secondary} from '@/components/screen';
import {WeeklyTimetable} from '@/components/weekly-timetable';
import {COURSES, bundleKey, currentTermOf, useBundlesFor, useTerms, type Meeting} from '@/lib/data/catalog';
import {useCourseRecords} from '@/lib/data/course-records';
import {deletePlannedSchedule, removePlannedCourse, usePlannedSchedule} from '@/lib/data/saved-schedules';
import {byDayThenStart, minToLabel} from '@/lib/time';

type Mode = 'planned' | 'enrolled';
type Entry = {course_id: string; code: string; credits: number; bundle_id: string | null; meetings: Meeting[]; score: number | null};

// Planned entries come from the DIG fixture, so their instructor score is looked up in the mock catalog.
const fixtureScore = (courseId: string, bundleId: string) => COURSES.find((c) => c.id === courseId)?.bundles.find((b) => b.bundle_id === bundleId)?.instructor_score ?? null;

function CourseDetail({entry}: {entry: Entry}) {
  const score = entry.score;
  const row = 'flex justify-between gap-3 border-b border-neutral-200 py-2 text-sm';
  return (
    <section aria-label="Course detail" className="mt-4 rounded-xl border border-neutral-200 p-3">
      <h2 className="font-semibold">{entry.code}</h2>
      <dl>
        <div className={row}>
          <dt className="text-neutral-600">Credits</dt>
          <dd>{entry.credits}</dd>
        </div>
        <div className={row}>
          <dt className="text-neutral-600">Section</dt>
          <dd>{entry.bundle_id ?? 'Unknown'}</dd>
        </div>
        {[...entry.meetings].sort(byDayThenStart).map((m) => (
          <div className={row} key={m.day + m.start_min}>
            <dt className="text-neutral-600">{m.day}</dt>
            <dd>
              {minToLabel(m.start_min)}–{minToLabel(m.end_min)} · {m.building_id ?? 'Building unknown'}
            </dd>
          </div>
        ))}
        <div className={row}>
          <dt className="text-neutral-600">Instructor rating</dt>
          <dd>{score === null ? 'No rating' : `${Math.round(score * 100)}%`}</dd>
        </div>
      </dl>
      <Link href={`/community?course=${entry.course_id}`} className={`${secondary} mt-3 block text-center`}>
        Posts tagged {entry.code}
      </Link>
    </section>
  );
}

// "/" is the Schedule tab: the default entry screen.
export default function SchedulePage() {
  const [mode, setMode] = useState<Mode>('planned');
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const plan = usePlannedSchedule();
  const records = useCourseRecords();

  // Two separate lists. A plan and self-reported enrollment are never merged into one timetable.
  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const termLabel = (id: string | null) => terms.find((t) => t.id === id)?.label ?? id ?? 'No current term';
  const mine = records.filter((r) => currentTerm !== null && r.term === currentTerm && r.status === 'enrolled_self_reported');
  const sections = useBundlesFor(mine); // meetings and instructor score from the catalog

  const planned: Entry[] = (plan?.selected ?? []).map((s) => ({course_id: s.course_id, code: s.course_code, credits: s.credits, bundle_id: s.bundle_id, meetings: s.meetings, score: fixtureScore(s.course_id, s.bundle_id)}));
  const enrolled: Entry[] = mine.map((r) => ({
    course_id: r.course_id,
    code: r.course_code ?? COURSES.find((c) => c.id === r.course_id)?.code ?? r.course_id,
    credits: r.credits,
    bundle_id: r.bundle_id,
    meetings: sections[bundleKey(r)]?.meetings ?? [],
    score: sections[bundleKey(r)]?.instructor_score ?? null,
  }));
  const entries = mode === 'planned' ? planned : enrolled;
  const timed = entries.filter((e) => e.meetings.length > 0);
  const detail = entries.find((e) => e.course_id === picked);
  async function editPlan(courseId?: string) {
    if (!plan || busy.current) return;
    busy.current = true;
    setEditing(true);
    setError(false);
    try {
      if (courseId) await removePlannedCourse(plan, courseId);
      else await deletePlannedSchedule(plan);
      setPicked(null);
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setEditing(false);
    }
  }
  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => {
        setMode(m);
        setPicked(null);
      }}
      className={`flex-1 rounded-lg py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent ${mode === m ? 'bg-white font-semibold shadow-sm' : 'text-neutral-600'}`}
    >
      {label}
    </button>
  );

  return (
    <Screen title="Schedule">
      <div role="tablist" aria-label="Schedule type" className="mb-3 flex rounded-xl bg-neutral-100 p-1">
        {tab('planned', 'Planned')}
        {tab('enrolled', 'Self-reported')}
      </div>
      <p className="mb-3 text-xs text-neutral-600">
        {mode === 'planned' ? `${termLabel(plan?.term ?? currentTerm)} · Planned only. Not a registration.` : `${termLabel(currentTerm)} · Self-reported — not verified by UW.`}
      </p>

      {entries.length === 0 &&
        (mode === 'planned' ? (
          <>
            <EmptyState title="No plan saved" body="Generate schedules in DIG and save one here." />
            <Link href="/dig" className={`${secondary} block text-center`}>
              Open DIG
            </Link>
          </>
        ) : (
          <>
            <EmptyState title="No current courses" body="Add the courses you're taking this term." />
            <Link href="/profile" className={`${secondary} block text-center`}>
              Add courses
            </Link>
          </>
        ))}

      {timed.length > 0 && <WeeklyTimetable items={timed.map((e) => ({label: e.code, meetings: e.meetings}))} onSelect={(i) => setPicked(timed[i].course_id)} />}

      {entries.length > 0 && (
        <ul className="mt-3">
          {entries.map((e) => (
            <li key={e.course_id} className="flex items-center justify-between gap-2 border-b border-neutral-200 py-2.5 text-sm">
              <button type="button" onClick={() => setPicked(e.course_id)} className="text-left focus-visible:outline-2 focus-visible:outline-accent">
                <span className="font-semibold">{e.code}</span>
                <span className="text-neutral-600">
                  {' '}
                  · {e.credits} cr · {e.meetings.length ? e.bundle_id : 'meeting time unknown'}
                </span>
              </button>
              {mode === 'planned' && (
                <button type="button" disabled={editing} aria-label={`Remove ${e.code}`} onClick={() => editPlan(e.course_id)} className="text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {mode === 'planned' && planned.length > 0 && (
        <button type="button" disabled={editing} onClick={() => editPlan()} className={`${secondary} mt-3 w-full`}>
          Delete plan
        </button>
      )}
      {mode === 'planned' && error && <p role="alert" className="mt-2 text-sm text-accent">Couldn’t update the plan. Try again.</p>}
      {mode === 'enrolled' && enrolled.length > 0 && (
        <Link href="/profile" className={`${secondary} mt-3 block text-center`}>
          Edit courses
        </Link>
      )}

      {detail && <CourseDetail entry={detail} />}

      <Link href="/friends" className={`${secondary} mt-6 block text-center`}>
        Friends
      </Link>
    </Screen>
  );
}
