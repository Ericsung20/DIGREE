'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useRef, useState} from 'react';
import {EmptyState, Screen, field, iconButton, primary, secondary} from '@/components/screen';
import {WeeklyTimetable} from '@/components/weekly-timetable';
import {COURSES, bundleKey, currentTermOf, useBuildingNames, useBundlesFor, useCourseInfo, useTerms, type Meeting} from '@/lib/data/catalog';
import {STATUS_LABEL, useCourseRecords} from '@/lib/data/course-records';
import {deletePlannedSchedule, removePlannedCourse, usePlannedSchedule} from '@/lib/data/saved-schedules';
import {byDayThenStart, minToLabel} from '@/lib/time';

type Mode = 'planned' | 'enrolled';
type Entry = {course_id: string; code: string; credits: number; section: string | null; meetings: Meeting[]; score: number | null; instructors: string[]};

function CourseDetail({entry, back, editHref}: {entry: Entry; back: string; editHref?: string}) {
  const score = entry.score;
  const course = useCourseInfo(entry.course_id);
  const buildings = useBuildingNames(entry.meetings.flatMap((meeting) => meeting.building_id ? [meeting.building_id] : []));
  const row = 'flex justify-between gap-3 border-b border-neutral-200 py-2 text-sm';
  return (
    <Screen title={entry.code} description={course?.title ?? undefined} back={{href: back, label: 'Back to schedule'}}>
      <section aria-label="Course detail" className="surface">
      <dl>
        <div className={row}>
          <dt className="text-neutral-600">Credits</dt>
          <dd>{entry.credits}</dd>
        </div>
        <div className={row}>
          <dt className="text-neutral-600">Section</dt>
          <dd>{entry.section ?? 'Unavailable'}</dd>
        </div>
        {[...entry.meetings].sort(byDayThenStart).map((m) => (
          <div className={row} key={`${m.day}-${m.start_min}-${m.end_min}`}>
            <dt className="text-neutral-600">{m.day}</dt>
            <dd>
              {minToLabel(m.start_min)}–{minToLabel(m.end_min)} · {m.building_id ? buildings[m.building_id] ?? m.building_id : m.mode === 'online_sync' ? 'Online' : 'Building unavailable'}
            </dd>
          </div>
        ))}
        <div className={row}>
          <dt className="text-neutral-600">Instructor</dt>
          <dd className="text-right">{entry.instructors.length ? entry.instructors.join(', ') : 'Unavailable'}</dd>
        </div>
        <div className={row}>
          <dt className="text-neutral-600">Instructor rating</dt>
          <dd>{score === null ? 'No rating' : `${Math.round(score * 100)}%`}</dd>
        </div>
      </dl>
      {editHref && <Link href={editHref} className={`${secondary} mt-3 w-full`}>Edit course</Link>}
      <Link href={`/community?course=${encodeURIComponent(entry.course_id)}`} className={`${secondary} mt-3 w-full`}>
        Posts tagged {entry.code}
      </Link>
      </section>
    </Screen>
  );
}

// "/" is the Schedule tab: the default entry screen.
function Schedule() {
  const params = useSearchParams();
  const router = useRouter();
  const mode: Mode = params.get('view') === 'plans' ? 'planned' : 'enrolled';
  const picked = params.get('course');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const records = useCourseRecords();

  // Two separate lists. A plan and self-reported enrollment are never merged into one timetable.
  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const term = terms.find((t) => t.id === params.get('term'))?.id ?? currentTerm ?? terms.at(-1)?.id ?? '';
  const plan = usePlannedSchedule(term);
  const mine = records.filter((r) => r.term === term && ['completed', 'enrolled_self_reported'].includes(r.status));
  const sections = useBundlesFor([...mine, ...(plan?.selected ?? []).map((entry) => ({...entry, term}))]);
  const scheduleUrl = (mode: Mode, term: string, course?: string) => {
    const query = new URLSearchParams();
    if (term) query.set('term', term);
    if (mode === 'planned') query.set('view', 'plans');
    if (course) query.set('course', course);
    return query.size ? `/?${query}` : '/';
  };
  const back = scheduleUrl(mode, term);
  const add = `/schedule/courses?${new URLSearchParams({term, view: mode === 'planned' ? 'plans' : 'courses'})}`;

  const planned: Entry[] = (plan?.selected ?? []).map((s) => {
    const section = sections[bundleKey({...s, term})];
    return {course_id: s.course_id, code: s.course_code, credits: s.credits, section: section?.label ?? s.bundle_id, meetings: s.meetings, score: section?.instructor_score ?? null, instructors: section?.instructors ?? []};
  });
  const enrolled: Entry[] = mine.map((r) => ({
    course_id: r.course_id,
    code: r.course_code ?? COURSES.find((c) => c.id === r.course_id)?.code ?? r.course_id,
    credits: r.credits,
    section: sections[bundleKey(r)]?.label ?? r.bundle_id,
    meetings: sections[bundleKey(r)]?.meetings ?? [],
    score: sections[bundleKey(r)]?.instructor_score ?? null,
    instructors: sections[bundleKey(r)]?.instructors ?? [],
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
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setEditing(false);
    }
  }
  const tab = (m: Mode, label: string) => (
    <Link
      href={scheduleUrl(m, term)}
      aria-current={mode === m ? 'true' : undefined}
      className="min-h-10 rounded-full px-3.5 py-1.5 text-sm font-extrabold text-neutral-600 aria-[current=true]:bg-neutral-900 aria-[current=true]:text-white"
    >
      {label}
    </Link>
  );

  if (detail) return <CourseDetail entry={detail} back={back} editHref={mode === 'enrolled' && term === currentTerm ? `${add}&course=${encodeURIComponent(detail.course_id)}` : undefined} />;
  return (
    <Screen title="My schedule" home actions={
      <Link href="/friends" aria-label="Friends" className={iconButton}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </Link>
    }>
      <div className="mb-3 flex items-center justify-between gap-2">
        <select aria-label="Schedule semester" className={`${field} mt-0 max-w-64 text-lg`} value={term} onChange={(event) => router.push(scheduleUrl(mode, event.target.value))} disabled={!terms.length}>
          {!terms.length && <option value="">Loading semesters…</option>}
          {terms.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <Link href={add} aria-label="Add course" className={`${iconButton} bg-neutral-100 hover:bg-neutral-200`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </Link>
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-1">
        <nav aria-label="Schedule type" className="flex gap-1">
          {tab('enrolled', term === currentTerm ? STATUS_LABEL.enrolled_self_reported : 'My courses')}
          {tab('planned', 'Plans')}
        </nav>
        {!!entries.length && <p className="px-1 text-sm font-bold text-neutral-600">{entries.reduce((total, entry) => total + entry.credits, 0)} cr</p>}
      </div>
      <p className="mb-4 px-1 text-xs text-neutral-600">
        {mode === 'planned' ? 'Planned only. Not a registration.' : 'Based on the courses you enter yourself.'}
      </p>

      {entries.length === 0 &&
        (mode === 'planned' ? (
          <>
            <EmptyState title="No plan saved" body="Generate schedules in DIG and save one here." />
            <Link href={term ? `/dig?term=${encodeURIComponent(term)}` : '/dig'} className={primary}>
              Generate a plan
            </Link>
          </>
        ) : (
          <>
            <EmptyState title="No courses for this semester" body="Add your courses to see them here." />
            <Link href={add} className={`${secondary} w-full`}>
              Add courses
            </Link>
            <Link href="/dig" className={`${primary} mt-2`}>Generate a plan</Link>
          </>
        ))}

      {timed.length > 0 && <WeeklyTimetable items={timed.map((e) => ({label: e.code, meetings: e.meetings}))} onSelect={(i) => router.push(scheduleUrl(mode, term, timed[i].course_id))} />}

      {entries.length > 0 && (
        <ul className="surface mt-3 py-1">
          {entries.map((e) => (
            <li key={e.course_id} className="flex items-center justify-between gap-2 border-b border-neutral-200 py-2.5 text-sm last:border-0">
              <Link href={scheduleUrl(mode, term, e.course_id)} className="text-left focus-visible:outline-2 focus-visible:outline-accent">
                <span className="font-semibold">{e.code}</span>
                <span className="text-neutral-600">
                  {' '}
                  · {e.credits} cr · {e.meetings.length ? e.section : 'meeting time unknown'}
                </span>
              </Link>
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
        <Link href={add} className={`${secondary} mt-3 w-full`}>
          Edit courses
        </Link>
      )}

    </Screen>
  );
}

export default function SchedulePage() {
  return <Suspense fallback={<Screen title="My schedule" home><p role="status">Loading schedule…</p></Screen>}><Schedule /></Suspense>;
}
