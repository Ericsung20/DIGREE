'use client';
import {Sheet} from './sheet';
import {displayCourseCode} from '@/lib/course-identity';
import {bundleKey, useBuildingNames, useBundlesFor, useCourseInfo, type Meeting} from '@/lib/data/catalog';
import {useRemote} from '@/lib/data/local-store';
import {IS_MOCK} from '@/lib/supabase';
import {sectionType, type SectionDetail} from '@/lib/section-details';
import {DAY_NAMES, dayIndex, timeOfDay} from '@/lib/ui/format';
import {s} from '@/lib/ui/css';

type DetailsState = {details: SectionDetail[]; loading: boolean; error: string | null};
const LOADING: DetailsState = {details: [], loading: true, error: null};
export type PreviewClass = {course_id: string; course_code: string; bundle_id: string; credits: number; meetings: Meeting[]; meeting: Meeting};
export function PreviewClassDetails({term, entry, onDismiss}: {term: string; entry: PreviewClass; onDismiss: () => void}) {
  const course = useCourseInfo(entry.course_id);
  const ref = {term, course_id: entry.course_id, bundle_id: entry.bundle_id};
  const bundle = useBundlesFor([ref])[bundleKey(ref)];
  const buildings = useBuildingNames(entry.meetings.flatMap(meeting => meeting.building_id ? [meeting.building_id] : []));
  const state = useRemote(`section-details:${term}:${entry.course_id}:${entry.bundle_id}`, LOADING, async (): Promise<DetailsState> => {
    if (IS_MOCK) return {details: [], loading: false, error: null};
    try {
      const params = new URLSearchParams({term, course: entry.course_id, bundle: entry.bundle_id});
      const response = await fetch(`/api/catalog/section-details?${params}`);
      const body = await response.json();
      return {details: response.ok ? body.details : [], loading: false, error: response.ok ? null : body.error};
    } catch {return {details: [], loading: false, error: 'Detailed section information is temporarily unavailable.'};}
  });
  const matches = state.details.filter(row => row.day === entry.meeting.day && row.start_min === entry.meeting.start_min && row.end_min === entry.meeting.end_min && (!row.building_id || !entry.meeting.building_id || row.building_id === entry.meeting.building_id));
  const sectionLabel = bundle?.label && bundle.label !== entry.bundle_id ? bundle.label : [...new Set(state.details.map(row => `${row.type} ${row.section}`))].join(' + ') || 'Section combination';
  const location = (meeting: Meeting) => meeting.mode === 'online_sync' ? 'Online' : meeting.building_id ? buildings[meeting.building_id] ?? 'Building name unavailable' : 'Location not listed';
  return <Sheet title={course ? displayCourseCode(course) : entry.course_code} onDismiss={onDismiss}>
    {course?.title && <p style={s('font-size: 17px; font-weight: 800; margin: 0 0 14px')}>{course.title}</p>}
    <p style={s('margin: 0 0 14px; color: #5F5A55')}>{entry.credits} credits · {sectionLabel}</p>
    <section style={s('background: #F7F5F2; padding: 14px; border-radius: 16px; display: grid; gap: 8px')}>
      <strong>{DAY_NAMES[dayIndex(entry.meeting.day)]} · {timeOfDay(entry.meeting.start_min)}–{timeOfDay(entry.meeting.end_min)}</strong>
      <span>{location(entry.meeting)}</span>
      {state.loading && <span role="status">Loading lecture/discussion details…</span>}
      {matches.map((row, i) => <div key={`${row.type}:${row.section}:${i}`} style={s('display: grid; gap: 6px; border-top: 1px solid #DDD8D2; padding-top: 10px')}>
        <strong>{sectionType(row.type)} · {row.type} {row.section}</strong>
        <span>{row.building ?? location(entry.meeting)}{row.room ? ` · Room ${row.room}` : ''}</span>
        {row.instructors.length > 0 && <span>{row.instructors.join(', ')}</span>}
      </div>)}
      {!state.loading && !matches.length && <span style={s('font-size: 13px; color: #5F5A55')}>{state.error ?? 'The published source does not identify a matching lecture/discussion for this block.'}</span>}
    </section>
    <h3 style={s('font-size: 15px; margin: 18px 0 8px')}>All meetings in this section combination</h3>
    <ul style={s('padding-left: 18px; margin: 0; display: grid; gap: 8px; font-size: 14px')}>
      {entry.meetings.map((meeting, i) => <li key={i}>{DAY_NAMES[dayIndex(meeting.day)]} · {timeOfDay(meeting.start_min)}–{timeOfDay(meeting.end_min)}<br />{location(meeting)}</li>)}
    </ul>
  </Sheet>;
}
