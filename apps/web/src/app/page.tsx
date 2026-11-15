'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useRef, useState} from 'react';
import {AvatarLink, EmptyNote, Frame, ICON, Svg, TabBar, Wordmark} from '@/components/dg';
import {DayHeads, HourAxis, dayColumn, gridHours} from '@/components/week';
import {bundleKey, currentTermOf, useBuildingNames, useBundlesFor, useCourseDetails, useTerms, type Meeting} from '@/lib/data/catalog';
import {usePosts} from '@/lib/data/community';
import {useCourseRecords} from '@/lib/data/course-records';
import {removePlannedCourse, usePlannedSchedule} from '@/lib/data/saved-schedules';
import {s} from '@/lib/ui/css';
import {DAY_NAMES, WEEKDAYS, meetingSummary, plural, shortCode, shortPlace} from '@/lib/ui/format';
import {TONES, useCourseTone, type Tone} from '@/lib/ui/palette';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes pop{0%{opacity:0;transform:translateY(14px) scale(.92)}100%{opacity:1;transform:none}}
@keyframes fadeUp{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.94)}
.dig:hover svg{animation:dig 600ms ease-in-out}
@keyframes dig{0%,100%{transform:rotate(0)}30%{transform:rotate(-18deg) translateY(2px)}60%{transform:rotate(10deg) translateY(-1px)}}
`;

const H = 52;
type View = 'enrolled' | 'plans';
type Entry = {course_id: string; code: string; name: string; credits: number; section: string; meetings: Meeting[]; tone: Tone};

const TAB = 'height: 34px; padding: 0 14px; border: none; border-radius: 17px; font-size: 14px; cursor: pointer; ';
const SHEET_ACTION = 'flex: 1; height: 48px; border: none; border-radius: 16px; background: #F1EEEA; color: #1D1B1A; font-size: 15px; font-weight: 800; text-decoration: none; display: flex; align-items: center; justify-content: center; cursor: pointer';

// "/" is the Schedule tab: the default entry screen.
function Schedule() {
  const params = useSearchParams();
  const router = useRouter();
  const view: View = params.get('view') === 'plans' ? 'plans' : 'enrolled';
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const busy = useRef(false);

  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const term = terms.find((item) => item.id === params.get('term'))?.id ?? currentTerm ?? terms.at(-1)?.id ?? '';
  const termLabel = terms.find((item) => item.id === term)?.label ?? '';
  const records = useCourseRecords();
  const plan = usePlannedSchedule(term);
  const toneOf = useCourseTone();
  const posts = usePosts();

  // Two separate lists. A plan and self-reported enrollment are never merged into one timetable.
  const mine = records.filter((record) => record.term === term && (record.status === 'enrolled_self_reported' || record.status === 'completed'));
  const planned = plan?.selected ?? [];
  const sections = useBundlesFor([...mine, ...planned.map((entry) => ({...entry, term}))]);
  const details = useCourseDetails([...mine, ...planned].map((entry) => entry.course_id));
  const entries: Entry[] = view === 'plans'
    ? planned.map((entry, i) => ({
      course_id: entry.course_id, code: entry.course_code, name: details[entry.course_id]?.title ?? entry.course_code, credits: entry.credits,
      section: sections[bundleKey({...entry, term})]?.label ?? entry.bundle_id, meetings: entry.meetings, tone: TONES[i % TONES.length],
    }))
    : mine.map((record, i) => {
      const section = sections[bundleKey(record)];
      const code = record.course_code ?? details[record.course_id]?.code ?? record.course_id;
      return {
        course_id: record.course_id, code, name: details[record.course_id]?.title ?? code, credits: record.credits,
        section: section?.label ?? record.bundle_id ?? '—', meetings: section?.meetings ?? [], tone: term === currentTerm ? toneOf(record.course_id) : TONES[i % TONES.length],
      };
    });
  const buildings = useBuildingNames(entries.flatMap((entry) => entry.meetings.flatMap((meeting) => (meeting.building_id ? [meeting.building_id] : []))));
  const place = (meeting: Meeting) => (meeting.building_id ? buildings[meeting.building_id] ?? meeting.building_id : meeting.mode === 'online_sync' ? 'Online' : '');

  const url = (nextView: View, nextTerm: string) => {
    const query = new URLSearchParams();
    if (nextTerm && nextTerm !== currentTerm) query.set('term', nextTerm);
    if (nextView === 'plans') query.set('view', 'plans');
    return query.size ? `/?${query}` : '/';
  };
  const go = (nextView: View, nextTerm: string) => {
    setOpen(false);
    router.replace(url(nextView, nextTerm), {scroll: false});
  };

  const onGrid = (meeting: Meeting) => (WEEKDAYS as string[]).includes(meeting.day);
  const {start, end} = gridHours(entries.flatMap((entry) => entry.meetings.filter(onGrid)));
  const offGrid = entries.map((entry, index) => ({entry, index})).filter(({entry}) => !entry.meetings.some(onGrid));
  const days = WEEKDAYS.map((day, d) => ({
    day,
    blocks: entries.flatMap((entry, index) => entry.meetings.filter((meeting) => meeting.day === day).map((meeting) => ({entry, index, meeting, name: DAY_NAMES[d]}))),
  }));
  const drawn = days.flatMap((day) => day.blocks); // blocks pop in one after another, in this order
  const c = entries[Math.min(sel, entries.length - 1)];
  const selected = c ? entries.indexOf(c) : -1;
  const postCount = c ? posts.filter((post) => post.course_id === c.course_id && !post.reported).length : 0;
  const query = `term=${encodeURIComponent(term)}`;

  async function removeFromPlan() {
    if (!plan || !c || busy.current) return;
    busy.current = true;
    try {
      await removePlannedCourse(plan, c.course_id);
      setOpen(false);
    } catch (error) {
      console.error('Updating the plan failed', error);
    } finally {
      busy.current = false;
    }
  }

  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 12px 20px 0; display: flex; flex-direction: column; gap: 14px; animation: fadeUp 420ms ease both')}>
        <div style={s('display: flex; align-items: center; justify-content: space-between; height: 44px')}>
          <Wordmark style="font-size: 26px; font-weight: 900; letter-spacing: -0.02em; line-height: 1" />
          <div style={s('display: flex; align-items: center; gap: 2px')}>
            <Link href="/friends" className="press" aria-label="Friends" style={s('width: 44px; height: 44px; color: #1D1B1A; display: flex; align-items: center; justify-content: center; border-radius: 22px; text-decoration: none')}>
              <Svg size={22} sw={2.2}>{ICON.friends}</Svg>
            </Link>
            <AvatarLink press />
          </div>
        </div>

        <div style={s('display: flex; align-items: center; justify-content: space-between')}>
          <label style={s('position: relative; border: none; background: transparent; padding: 0; display: flex; align-items: center; gap: 4px; color: #1D1B1A; cursor: pointer; min-height: 44px')}>
            <span style={s('font-size: 32px; font-weight: 900; letter-spacing: -0.02em')}>{termLabel || ' '}</span>
            <Svg size={22} sw={2.6} stroke="#6E6863">{ICON.down}</Svg>
            <select className="dg-native" aria-label={`Change semester, currently ${termLabel}`} value={term} onChange={(event) => go(view, event.target.value)} disabled={!terms.length}>
              {[...terms].reverse().map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <Link href={`/schedule/add?${query}`} className="press" aria-label="Add course" style={s('width: 44px; height: 44px; border-radius: 22px; background: #ECE8E3; color: #1D1B1A; display: flex; align-items: center; justify-content: center; text-decoration: none')}>
            <Svg size={20} sw={2.6} join={false}>{ICON.plus}</Svg>
          </Link>
        </div>

        <div style={s('display: flex; align-items: center; justify-content: space-between')}>
          <div role="tablist" aria-label="Schedule view" style={s('display: flex; gap: 6px')}>
            <button type="button" role="tab" aria-selected={view === 'enrolled'} onClick={() => go('enrolled', term)} style={s(TAB + (view === 'enrolled' ? 'background: #1D1B1A; color: #FFFFFF; font-weight: 800' : 'background: transparent; color: #5F5A55; font-weight: 700'))}>Enrolled</button>
            <button type="button" role="tab" aria-selected={view === 'plans'} onClick={() => go('plans', term)} style={s(TAB + (view === 'plans' ? 'background: #1D1B1A; color: #FFFFFF; font-weight: 800' : 'background: transparent; color: #5F5A55; font-weight: 700'))}>Plans · {plan ? 1 : 0}</button>
          </div>
          <span style={s('font-size: 14px; font-weight: 700; color: #5F5A55')}>{plural(entries.reduce((total, entry) => total + entry.credits, 0), 'credit')}</span>
        </div>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 14px 14px 12px 6px')}>
        <DayHeads />
        <div style={s('display: flex')}>
          <HourAxis start={start} end={end} H={H} />
          {days.map(({day, blocks}) => (
            <div key={day} style={s(dayColumn(end - start, H))}>
              {blocks.map((block) => {
                const {entry, index, meeting, name} = block;
                const on = open && selected === index;
                const position = drawn.indexOf(block);
                return (
                  <button
                    key={`${view}-${term}-${entry.course_id}-${meeting.start_min}`}
                    type="button"
                    aria-label={`${entry.code}, ${name}${place(meeting) ? `, ${place(meeting)}` : ''}`}
                    onClick={() => {
                      setSel(index);
                      setOpen(true);
                    }}
                    style={s(`position: absolute; left: 3px; right: 3px; top: ${(meeting.start_min / 60 - start) * H}px; height: ${((meeting.end_min - meeting.start_min) / 60) * H - 3}px; box-sizing: border-box; padding: 6px 7px; border: none; border-radius: 12px; background: ${entry.tone.bg}; color: ${entry.tone.fg}; text-align: left; overflow: hidden; cursor: pointer; font-family: inherit; animation: pop 520ms cubic-bezier(.2,.9,.25,1.2) both; animation-delay: ${120 + position * 45}ms; transition: transform 200ms ease, box-shadow 200ms ease; ${on ? `transform: scale(1.04); box-shadow: 0 0 0 2.5px ${entry.tone.fg}, 0 6px 16px rgba(0,0,0,0.12)` : ''}`)}
                  >
                    <span style={s('display: block; font-size: 12px; font-weight: 900; line-height: 1.2')}>{shortCode(entry.code)}</span>
                    <span style={s('display: block; font-size: 11px; font-weight: 600; line-height: 1.25; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{shortPlace(place(meeting))}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {offGrid.length > 0 && (
          <div style={s('display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 0 0 30px')}>
            {offGrid.map(({entry, index}) => (
              <button
                key={entry.course_id}
                type="button"
                aria-label={`${entry.code}, no weekday meeting time`}
                onClick={() => {
                  setSel(index);
                  setOpen(true);
                }}
                style={s(`box-sizing: border-box; padding: 6px 9px; border: none; border-radius: 12px; background: ${entry.tone.bg}; color: ${entry.tone.fg}; text-align: left; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 900; line-height: 1.2`)}
              >
                {shortCode(entry.code)}
              </button>
            ))}
          </div>
        )}
        {terms.length > 0 && entries.length === 0 && (
          <EmptyNote>{view === 'plans' ? `No plan for ${termLabel} yet. Tap DIG to dig one up.` : `No courses for ${termLabel} yet. Tap + to add one.`}</EmptyNote>
        )}
      </main>

      <TabBar active="schedule" digHover />

      <div aria-hidden="true" onClick={() => setOpen(false)} style={s(`position: absolute; inset: 0; z-index: 20; background: rgba(29,27,26,0.32); transition: opacity 300ms ease; ${open ? 'opacity: 1; pointer-events: auto' : 'opacity: 0; pointer-events: none'}`)} />
      {c && (
        <section role="dialog" aria-label="Course detail" aria-hidden={!open} style={s(`position: absolute; left: 0; right: 0; bottom: 0; z-index: 21; box-sizing: border-box; padding: 10px 20px 28px; background: #FFFFFF; border-radius: 28px 28px 0 0; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 -10px 40px rgba(0,0,0,0.12); transition: transform 420ms cubic-bezier(.2,.9,.25,1.05), visibility 420ms; transform: ${open ? 'translateY(0)' : 'translateY(105%)'}; visibility: ${open ? 'visible' : 'hidden'}`)}>
          <span aria-hidden="true" style={s('align-self: center; width: 40px; height: 5px; border-radius: 3px; background: #DDD8D2')} />
          <div style={s('display: flex; align-items: flex-start; justify-content: space-between; gap: 12px')}>
            <div style={s('display: flex; flex-direction: column; gap: 4px')}>
              <span style={s(`align-self: flex-start; height: 26px; padding: 0 10px; border-radius: 13px; background: ${c.tone.bg}; color: ${c.tone.fg}; font-size: 13px; font-weight: 900; display: inline-flex; align-items: center`)}>{c.code}</span>
              <h2 style={s('margin: 0; font-size: 22px; font-weight: 900; line-height: 1.2')}>{c.name}</h2>
            </div>
            <button type="button" className="press" aria-label="Close" onClick={() => setOpen(false)} style={s('flex-shrink: 0; width: 40px; height: 40px; border: none; border-radius: 20px; background: #F1EEEA; color: #1D1B1A; display: flex; align-items: center; justify-content: center; cursor: pointer')}>
              <Svg size={18} sw={2.6} join={false}>{ICON.x}</Svg>
            </button>
          </div>
          <div style={s('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px')}>
            <div style={s('padding: 12px 14px; border-radius: 16px; background: #F7F5F2; display: flex; flex-direction: column; gap: 2px')}><span style={s('font-size: 12px; font-weight: 700; color: #5F5A55')}>Credits</span><span style={s('font-size: 18px; font-weight: 900')}>{c.credits}</span></div>
            <div style={s('padding: 12px 14px; border-radius: 16px; background: #F7F5F2; display: flex; flex-direction: column; gap: 2px')}><span style={s('font-size: 12px; font-weight: 700; color: #5F5A55')}>Section</span><span style={s('font-size: 18px; font-weight: 900')}>{c.section}</span></div>
          </div>
          <div style={s('display: flex; flex-direction: column; gap: 10px; font-size: 15px; font-weight: 600')}>
            <span style={s('display: flex; align-items: center; gap: 10px')}><Svg size={18} sw={2.2} stroke="#6E6863">{ICON.clock}</Svg>{c.meetings.length ? meetingSummary(c.meetings) : 'No set meeting time'}</span>
            <span style={s('display: flex; align-items: center; gap: 10px')}><Svg size={18} sw={2.2} stroke="#6E6863">{ICON.pin}</Svg>{[...new Set(c.meetings.map(place).filter(Boolean))].join(', ') || 'Location not listed'}</span>
          </div>
          <div style={s('display: flex; gap: 8px; margin-top: 2px')}>
            <Link href={`/course/${encodeURIComponent(c.course_id)}?${query}${view === 'plans' ? '&view=plans' : ''}`} className="press" style={s(SHEET_ACTION)}>Details · {plural(postCount, 'post')}</Link>
            {view === 'plans'
              ? <button type="button" className="press" onClick={() => void removeFromPlan()} style={s(SHEET_ACTION)}>Remove from plan</button>
              : <Link href={`/schedule/add?${query}&course=${encodeURIComponent(c.course_id)}`} className="press" style={s(SHEET_ACTION)}>Change section</Link>}
          </div>
        </section>
      )}
    </Frame>
  );
}

export default function SchedulePage() {
  return <Suspense fallback={<Frame css={CSS} numeric><span /></Frame>}><Schedule /></Suspense>;
}
