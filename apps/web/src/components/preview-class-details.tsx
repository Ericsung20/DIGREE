'use client';
import {Sheet} from './sheet';
import {ICON, Svg} from './dg';
import {displayCourseCode} from '@/lib/course-identity';
import {bundleKey, useBuildingNames, useBundlesFor, useCourseInfo, type Meeting} from '@/lib/data/catalog';
import {useRemote} from '@/lib/data/local-store';
import {IS_MOCK} from '@/lib/supabase';
import {sectionType, type SectionDetail} from '@/lib/section-details';
import {DAY_NAMES, dayIndex, timeOfDay} from '@/lib/ui/format';
import {s} from '@/lib/ui/css';
import {TONES, hashIndex} from '@/lib/ui/palette';
import {byDayThenStart} from '@/lib/time';

type DetailsState = {details: SectionDetail[]; loading: boolean; error: string | null};
const LOADING: DetailsState = {details: [], loading: true, error: null};
export type PreviewClass = {course_id: string; course_code: string; bundle_id: string; credits: number; meetings: Meeting[]; meeting: Meeting};
export function PreviewClassDetails({term, entry, majorReasons, onDismiss}: {term: string; entry: PreviewClass; majorReasons?: string[]; onDismiss: () => void}) {
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
  const tone = TONES[hashIndex(entry.course_id, TONES.length)];
  const badge = <span style={s(`justify-self: start; padding: 3px 10px; border-radius: 16px; background: ${tone.bg}; color: ${tone.fg}; font-size: 13px; font-weight: 900`)}>{course ? displayCourseCode(course) : entry.course_code}</span>;
  const fact = 'padding: 12px 14px; border-radius: 16px; background: #F7F5F2; display: grid; gap: 2px';
  return <Sheet title={course?.title ?? entry.course_code} badge={badge} onDismiss={onDismiss}>
    <div style={s('display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 18px')}>
      <div style={s(fact)}><span style={s('font-size: 12px; font-weight: 700; color: #5F5A55')}>Credits</span><strong style={s('font-size: 18px; font-weight: 900')}>{entry.credits}</strong></div>
      <div style={s(fact)}><span style={s('font-size: 12px; font-weight: 700; color: #5F5A55')}>Section</span><strong style={s('font-size: 18px; font-weight: 900')}>{matches.length ? [...new Set(matches.map(row => `${row.type} ${row.section}`))].join(' + ') : sectionLabel}</strong></div>
    </div>
    <section style={s('display: grid; gap: 12px; font-size: 15px; font-weight: 600')}>
      <span style={s('display: flex; align-items: center; gap: 10px')}><Svg size={18} sw={2.2} stroke="#6E6863">{ICON.clock}</Svg>{DAY_NAMES[dayIndex(entry.meeting.day)]} · {timeOfDay(entry.meeting.start_min)}–{timeOfDay(entry.meeting.end_min)}</span>
      <span style={s('display: flex; align-items: center; gap: 10px')}><Svg size={18} sw={2.2} stroke="#6E6863">{ICON.pin}</Svg>{matches[0]?.building ?? location(entry.meeting)}{matches[0]?.room ? ` · Room ${matches[0].room}` : ''}</span>
      {state.loading && <span role="status">Loading lecture/discussion details…</span>}
      {matches.map((row, i) => <div key={`${row.type}:${row.section}:${i}`} style={s('display: grid; gap: 6px')}>
        <strong style={s('font-weight: 800')}>{sectionType(row.type)} · {row.type} {row.section}</strong>
        {row.instructors.length > 0 && <span>{row.instructors.join(', ')}</span>}
      </div>)}
      {!state.loading && !matches.length && <span style={s('font-size: 13px; color: #5F5A55')}>{state.error ?? 'The published source does not identify a matching lecture/discussion for this block.'}</span>}
    </section>
    {majorReasons?.length ? <p style={s('font-size: 13px; font-weight: 800; line-height: 1.5; color: #5F5A55')}>Major course · {majorReasons.join('; ')}</p> : null}
    <h3 style={s('font-size: 15px; font-weight: 900; margin: 20px 0 10px')}>All meetings in this section combination</h3>
    <ul style={s('padding-left: 18px; margin: 0; display: grid; gap: 8px; font-size: 14px')}>
      {[...entry.meetings].sort(byDayThenStart).map((meeting, i) => <li key={i}>{DAY_NAMES[dayIndex(meeting.day)]} · {timeOfDay(meeting.start_min)}–{timeOfDay(meeting.end_min)}<br />{location(meeting)}</li>)}
    </ul>
  </Sheet>;
}
