'use client';

import {useParams} from 'next/navigation';
import {useEffect, useState} from 'react';
import {BackLink, EmptyNote, Frame, Switch} from '@/components/dg';
import {DayHeads, HourAxis, dayColumn, gridHours} from '@/components/week';
import {initials} from '@/lib/data/account';
import {bundleKey, currentTermOf, useBundlesFor, useTerms, type Meeting} from '@/lib/data/catalog';
import {useCourseRecords} from '@/lib/data/course-records';
import {digTerm} from '@/lib/data/dig-session';
import {loadFriendSchedule, useFriends, type FriendScheduleView} from '@/lib/data/friends';
import {usePlannedSchedule} from '@/lib/data/saved-schedules';
import {s} from '@/lib/ui/css';
import {DAY_SHORT, WEEKDAYS, shortCode, timeOfDay} from '@/lib/ui/format';
import {TONES, personTone, useCourseTone} from '@/lib/ui/palette';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes pop{0%{opacity:0;transform:translateY(12px) scale(.92)}100%{opacity:1;transform:none}}
@keyframes fadeUp{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}
`;

const H = 48;
type Slot = Pick<Meeting, 'day' | 'start_min' | 'end_min'>;
type Loaded = {key: string; term: string; view: FriendScheduleView};
const MIN_FREE = 30; // shorter gaps are not worth meeting up for

/** Gaps between classes on one day when neither of us is busy. */
function sharedGaps(busy: Slot[]): {start: number; end: number}[] {
  const sorted = [...busy].sort((a, b) => a.start_min - b.start_min);
  const gaps = [];
  let free = sorted[0]?.end_min ?? 0;
  for (const slot of sorted.slice(1)) {
    if (slot.start_min - free >= MIN_FREE) gaps.push({start: free, end: slot.start_min});
    free = Math.max(free, slot.end_min);
  }
  return gaps;
}

export default function FriendSchedulePage() {
  const {friendId: raw} = useParams<{friendId: string}>();
  const friendId = decodeURIComponent(raw);
  const friend = useFriends().find((item) => item.id === friendId && item.status === 'accepted');
  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const planTerm = digTerm(terms, null);
  const [on, setOn] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${friendId}:${currentTerm}:${planTerm}:${friend?.theirVisibility}`;
  const result = loaded?.key === key ? loaded : null;

  // A friend's shared schedule is their saved plan. Show the current term's, or the one they are planning next.
  useEffect(() => {
    if (!friend || !terms.length) return;
    let active = true;
    const load = async () => {
      let shown: Omit<Loaded, 'key'> = {term: currentTerm ?? planTerm, view: {access: 'none'}};
      for (const term of [...new Set([currentTerm, planTerm])]) {
        if (!term) continue;
        const view = await loadFriendSchedule(friend, term).catch((): FriendScheduleView => ({access: 'none'}));
        if (view.access !== 'none' && shown.view.access === 'none') shown = {term, view};
        if (view.access === 'full' ? view.items.length : view.access === 'free_busy' && view.blocks.length) {
          shown = {term, view};
          break;
        }
      }
      if (active) setLoaded({key, ...shown});
    };
    void load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [friend, key, currentTerm, planTerm, terms.length]);

  // My side of the comparison for that term: what I am enrolled in, or my saved plan when the term has not started.
  const term = result?.term ?? currentTerm ?? '';
  const records = useCourseRecords().filter((record) => record.term === term && (record.status === 'enrolled_self_reported' || record.status === 'completed'));
  const sections = useBundlesFor(records);
  const plan = usePlannedSchedule(term);
  const toneOf = useCourseTone();
  const enrolled = records.map((record) => ({code: record.course_code ?? record.course_id, course_id: record.course_id, meetings: sections[bundleKey(record)]?.meetings ?? []}));
  const mine = enrolled.length ? enrolled : (plan?.selected ?? []).map((entry) => ({code: entry.course_code, course_id: entry.course_id, meetings: entry.meetings}));
  const myMeetings: Slot[] = mine.flatMap((course) => course.meetings);

  const view = result?.view;
  const items = view?.access === 'full' ? view.items : view?.access === 'free_busy' ? [{label: 'Busy', meetings: view.blocks}] : [];
  const theirs = items.flatMap((item) => item.meetings);
  const together = view?.access === 'full' ? view.items.filter((item) => mine.some((course) => course.code === item.label)) : [];
  const {start, end} = gridHours([...theirs, ...myMeetings]);
  const free = WEEKDAYS.map((day) => sharedGaps([...theirs, ...myMeetings].filter((slot) => slot.day === day)));
  const longest = Math.max(0, ...free.flat().map((gap) => gap.end - gap.start));
  const best = free.flat().find((gap) => gap.end - gap.start === longest);
  const bestDays = best ? free.flatMap((gaps, day) => (gaps.some((gap) => gap.start === best.start && gap.end === best.end) ? [DAY_SHORT[day]] : [])) : [];
  const blocks = WEEKDAYS.flatMap((day) => items.flatMap((item, index) => item.meetings.filter((meeting) => meeting.day === day).map((meeting) => ({item, index, meeting, day}))));
  const tone = (label: string, index: number) => {
    if (view?.access !== 'full') return {bg: '#ECE8E3', fg: '#3D3936'};
    const shared = mine.find((course) => course.code === label);
    return shared ? toneOf(shared.course_id) : TONES[index % TONES.length];
  };
  const avatar = personTone(friendId);
  const termLabel = terms.find((item) => item.id === term)?.label ?? '';
  const access = view?.access ?? 'none';
  const summary = on
    ? best ? `Both free ${bestDays.join(' & ')}, ${timeOfDay(best.start).replace(/ [AP]M$/, '')}–${timeOfDay(best.end).replace(/ [AP]M$/, '')}` : 'No shared break this week'
    : access === 'full' ? `${together.length} ${together.length === 1 ? 'class' : 'classes'} together` : 'Busy times only';

  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 8px 20px 4px 10px; display: flex; flex-direction: column; gap: 10px; animation: fadeUp 380ms ease both')}>
        <div style={s('display: flex; align-items: center; height: 44px')}>
          <BackLink href="/friends" label="Back to friends" />
        </div>
        <div style={s('padding-left: 10px; display: flex; align-items: center; gap: 12px')}>
          <span style={s(`width: 52px; height: 52px; border-radius: 26px; flex-shrink: 0; background: ${avatar.bg}; color: ${avatar.fg}; font-size: 18px; font-weight: 900; display: flex; align-items: center; justify-content: center`)}>{initials(friend?.name ?? '')}</span>
          <div style={s('display: flex; flex-direction: column; min-width: 0')}>
            <h1 style={s('margin: 0; font-size: 28px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>{friend?.name ?? 'Friend'}</h1>
            <span style={s('font-size: 14px; font-weight: 700; color: #5F5A55')}>{termLabel}{result ? ` · ${access === 'full' ? 'shares full schedule' : access === 'free_busy' ? 'shares free / busy only' : 'not sharing yet'}` : ''}</span>
          </div>
        </div>
        {access !== 'none' && (
          <div style={s('margin-left: 10px; min-height: 56px; padding: 0 8px 0 16px; border-radius: 20px; background: #FFFFFF; display: flex; align-items: center; justify-content: space-between; gap: 10px')}>
            <span style={s('display: flex; flex-direction: column')}><span style={s('font-size: 15px; font-weight: 900')}>Compare with mine</span><span style={s(`font-size: 13px; font-weight: 800; color: ${on ? '#355A1F' : '#5F5A55'}`)}>{summary}</span></span>
            <Switch on={on} label="Compare with my schedule" onToggle={() => setOn(!on)} />
          </div>
        )}
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 10px 14px 12px 6px')}>
        <DayHeads />
        <div style={s('display: flex')}>
          <HourAxis start={start} end={end} H={H} />
          {WEEKDAYS.map((day, d) => (
            <div key={day} style={s(dayColumn(end - start, H))}>
              {free[d].map((gap) => (
                <span key={gap.start} style={s(`position: absolute; left: 2px; right: 2px; top: ${(gap.start / 60 - start) * H + 2}px; height: ${((gap.end - gap.start) / 60) * H - 4}px; border-radius: 10px; background: #E3F0DA; display: flex; align-items: center; justify-content: center; transition: opacity 360ms ease ${on ? 200 + d * 60 : 0}ms, transform 420ms cubic-bezier(.2,.9,.25,1.2) ${on ? 200 + d * 60 : 0}ms; opacity: ${on ? 1 : 0}; transform: scaleY(${on ? 1 : 0.3})`)}><span style={s('font-size: 10px; font-weight: 900; color: #355A1F')}>Free</span></span>
              ))}
              {myMeetings.filter((slot) => slot.day === day).map((slot) => (
                <span key={slot.start_min} style={s(`position: absolute; left: 1px; right: 1px; top: ${(slot.start_min / 60 - start) * H - 1}px; height: ${((slot.end_min - slot.start_min) / 60) * H - 1}px; box-sizing: border-box; border-radius: 12px; border: 1.5px dashed #1D1B1A; z-index: 2; pointer-events: none; transition: opacity 300ms ease, transform 380ms cubic-bezier(.2,.9,.25,1.2); opacity: ${on ? 1 : 0}; transform: scale(${on ? 1 : 1.15})`)} />
              ))}
              {blocks.filter((block) => block.day === day).map((block) => {
                const c = tone(block.item.label, block.index);
                const shared = together.some((item) => item.label === block.item.label);
                return (
                  <div key={`${block.item.label}-${block.meeting.start_min}`} style={s(`position: absolute; left: 4px; right: 4px; top: ${(block.meeting.start_min / 60 - start) * H + 1}px; height: ${((block.meeting.end_min - block.meeting.start_min) / 60) * H - 4}px; box-sizing: border-box; padding: 5px 6px; border-radius: 10px; background: ${c.bg}; color: ${c.fg}; overflow: hidden; z-index: 1; animation: pop 520ms cubic-bezier(.2,.9,.25,1.2) both; animation-delay: ${120 + blocks.indexOf(block) * 50}ms`)}>
                    <span style={s('display: block; font-size: 12px; font-weight: 900; line-height: 1.2')}>{shortCode(block.item.label)}</span>
                    <span style={s(`display: inline-block; margin-top: 3px; padding: 1px 6px; border-radius: 8px; background: #1D1B1A; color: #FFFFFF; font-size: 9px; font-weight: 900; transition: opacity 260ms ease; opacity: ${on && shared ? 1 : 0}`)}>Together</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={s(`display: flex; gap: 16px; padding: 10px 0 0 30px; font-size: 13px; font-weight: 800; color: #5F5A55; transition: opacity 300ms ease; opacity: ${on ? 1 : 0}`)}>
          <span style={s('display: flex; align-items: center; gap: 6px')}><span aria-hidden="true" style={s('width: 18px; height: 12px; box-sizing: border-box; border-radius: 4px; border: 1.5px dashed #1D1B1A')} />You</span>
          <span style={s('display: flex; align-items: center; gap: 6px')}><span aria-hidden="true" style={s('width: 18px; height: 12px; border-radius: 4px; background: #E3F0DA')} />Both free</span>
        </div>
        {result && access === 'none' && <EmptyNote>{friend ? `${friend.name} isn’t sharing a schedule with you yet.` : 'This schedule isn’t available.'}</EmptyNote>}
        {result && access !== 'none' && theirs.length === 0 && <EmptyNote>{friend?.name ?? 'Your friend'} hasn’t saved a plan for {termLabel} yet.</EmptyNote>}
      </main>
    </Frame>
  );
}
