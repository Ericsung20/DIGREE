'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import {BackLink, Frame, ICON, Spade, Svg} from '@/components/dg';
import {DayHeads, HourAxis, dayColumn, gridHours} from '@/components/week';
import {currentTermOf, useBuildingNames, useTerms} from '@/lib/data/catalog';
import {digTerm, useDigRun} from '@/lib/data/dig-session';
import {savePlannedSchedule} from '@/lib/data/saved-schedules';
import {campusDays, describeOptions, sectionClash} from '@/lib/dig-view';
import {IS_MOCK} from '@/lib/supabase';
import {s} from '@/lib/ui/css';
import {DAY_SHORT, WEEKDAYS, dayIndex, meetingSummary, plural, shortCode, shortPlace} from '@/lib/ui/format';
import {DIG_TONES} from '@/lib/ui/palette';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes drop{0%{opacity:0;transform:translateY(-28px) scale(.9)}70%{opacity:1;transform:translateY(3px) scale(1.02)}100%{opacity:1;transform:none}}
@keyframes fadeUp{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}
@keyframes dig{0%,100%{transform:rotate(0) translateY(0)}25%{transform:rotate(-22deg) translateY(4px)}55%{transform:rotate(12deg) translateY(-2px)}}
@keyframes popIn{0%{opacity:0;transform:scale(.4)}100%{opacity:1;transform:none}}
.digging{animation:dig 420ms ease-in-out infinite;transform-origin:50% 90%}
.pop{animation:popIn 360ms cubic-bezier(.2,.9,.25,1.4) both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.95)}
`;

const H = 48;
const sectionTimes = (meetings: Parameters<typeof meetingSummary>[0]) => meetings.length ? meetingSummary(meetings, ' ') : 'Online, no set time';
const PLANTING_MS = 900; // the spade digs for at least this long before the button says "Planted"
type Phase = 'idle' | 'planting' | 'saved';

function SchedulePreview() {
  const params = useSearchParams();
  const router = useRouter();
  const terms = useTerms();
  const run = useDigRun();
  const term = run?.term ?? digTerm(terms, params.get('term'));
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  // Sections the student switched to, by course, for the option on screen.
  const [picks, setPicks] = useState<{rank: number | null; bundles: Record<string, string>}>({rank: null, bundles: {}});
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const results = run?.data?.results ?? [];
  const names = useBuildingNames(results.flatMap((result) => result.selected.flatMap((entry) => entry.meetings.flatMap((meeting) => (meeting.building_id ? [meeting.building_id] : [])))));
  const required = run?.mustTake.map((course) => course.id) ?? [];
  const options = run?.data ? describeOptions(run.data, run.conditions, required, (id) => names[id] ?? id) : [];
  const position = Math.max(0, options.findIndex((option) => String(option.rank) === params.get('option')));
  const option = options[position];

  // The run lives in memory, so a reload has nothing to preview: back to the conditions.
  const missing = terms.length > 0 && (!run || (!run.digging && !option));
  const setup = `/dig?term=${encodeURIComponent(term)}`;
  useEffect(() => {
    if (!missing) return;
    const redirect = window.setTimeout(() => router.replace(setup), 60);
    return () => window.clearTimeout(redirect);
  }, [missing, router, setup]);

  const order = [...required, ...results.flatMap((result) => result.selected.map((entry) => entry.course_id))].filter((id, i, all) => all.indexOf(id) === i);
  const tone = (courseId: string) => DIG_TONES[order.indexOf(courseId) % DIG_TONES.length];
  const choices = run?.data?.sections ?? {};
  const picked = picks.rank === option?.rank ? picks.bundles : {};
  const selected = (option?.result.selected ?? []).map((entry) => {
    const other = choices[entry.course_id]?.find((section) => section.bundle_id === picked[entry.course_id]);
    return other ? {...entry, bundle_id: other.bundle_id, meetings: other.meetings} : entry;
  });
  const changed = selected.some((entry, i) => entry.bundle_id !== option?.result.selected[i]?.bundle_id);
  const clash = sectionClash(selected);
  const pick = (courseId: string, bundleId: string) => {
    if (!option) return;
    setPicks({rank: option.rank, bundles: {...picked, [courseId]: bundleId}});
    setPhase('idle');
    setError(null);
  };
  const {start, end} = gridHours(selected.flatMap((entry) => entry.meetings));
  const off = run ? run.conditions.days.flatMap((on, day) => (on ? [] : [day])) : [];
  const blocks = WEEKDAYS.flatMap((day) => selected.flatMap((entry) => entry.meetings.filter((meeting) => meeting.day === day).map((meeting) => ({entry, meeting, day}))));
  const currentLabel = terms.find((item) => item.id === currentTermOf(terms))?.label;

  async function save() {
    if (phase !== 'idle' || !run?.data || !option || clash) return;
    if (run.data.sample && !IS_MOCK) return setError('Sample results can’t be saved to your account.');
    setPhase('planting');
    setError(null);
    try {
      // The save and the digging animation run together; the button reports back when both are done.
      const planted = new Promise<void>((resolve) => {
        timer.current = window.setTimeout(resolve, PLANTING_MS);
      });
      await Promise.all([savePlannedSchedule({term: run.term, selected}, run.data.request_id), planted]);
      setPhase('saved');
    } catch {
      setPhase('idle');
      setError('Couldn’t save the plan. Try again.');
    }
  }

  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 8px 20px 4px 10px; display: flex; flex-direction: column; gap: 6px; animation: fadeUp 380ms ease both')}>
        <div style={s('display: flex; align-items: center; justify-content: space-between; height: 44px')}>
          <BackLink href={`/dig/results?term=${encodeURIComponent(term)}`} label="Back to options" />
          <span style={s('font-size: 14px; font-weight: 800; color: #5F5A55')}>{option ? `Option ${position + 1} of ${options.length}` : ''}</span>
        </div>
        <div style={s('padding-left: 10px; display: flex; flex-direction: column; gap: 4px')}>
          <h1 style={s('margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>{run ? `${run.termLabel} plan` : ' '}</h1>
          <span style={s('font-size: 14px; font-weight: 700; color: #5F5A55')}>{option ? `${plural(option.credits, 'credit')} · ${campusDays({...option.result, selected})} · ${changed ? 'walks not rechecked' : option.walk ? `${option.walk} max walk` : 'walking time unverified'}` : ' '}</span>
        </div>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 8px 6px; display: flex; flex-direction: column; gap: 10px')}>
        <DayHeads muted={off} />
        <div style={s('display: flex; margin-top: -10px; flex-shrink: 0')}>
          <HourAxis start={start} end={end} H={H} />
          {WEEKDAYS.map((day, d) => (
            <div key={day} style={s(off.includes(d) ? `flex: 1; position: relative; height: ${(end - start) * H}px; background: repeating-linear-gradient(135deg, #F1EEEA 0, #F1EEEA 6px, transparent 6px, transparent 12px); border-radius: 12px; margin-left: 3px` : dayColumn(end - start, H))}>
              {blocks.filter((block) => block.day === day).map((block) => {
                const c = tone(block.entry.course_id);
                const added = !required.includes(block.entry.course_id);
                const place = block.meeting.building_id ? names[block.meeting.building_id] ?? block.meeting.building_id : block.meeting.mode === 'online_sync' ? 'Online' : '';
                return (
                  <div key={`${block.entry.bundle_id}-${block.meeting.day}-${block.meeting.start_min}`} style={s(`position: absolute; left: 3px; right: 3px; top: ${(block.meeting.start_min / 60 - start) * H}px; height: ${((block.meeting.end_min - block.meeting.start_min) / 60) * H - 3}px; box-sizing: border-box; padding: 5px 7px; border-radius: 12px; color: ${c.fg}; overflow: hidden; animation: drop 620ms cubic-bezier(.2,.9,.25,1) both; animation-delay: ${160 + blocks.indexOf(block) * 70}ms; ${added ? `background: ${c.light}; border: 1.5px dashed ${c.fg}` : `background: ${c.bg}`}`)}>
                    <span style={s('display: block; font-size: 12px; font-weight: 900; line-height: 1.2')}>{shortCode(block.entry.course_code)}</span>
                    <span style={s('display: block; font-size: 11px; font-weight: 600; line-height: 1.25; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{shortPlace(place)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={s('display: flex; align-items: center; gap: 8px; padding-left: 30px; font-size: 13px; font-weight: 700; color: #5F5A55')}>
          <span aria-hidden="true" style={s('width: 22px; height: 14px; box-sizing: border-box; border-radius: 4px; border: 1.5px dashed #8A847E')} />
          Dashed = dug up by DIG
        </div>

        {selected.length > 0 && (
          <section aria-label="Sections" style={s('margin: 6px 0 0 8px; display: flex; flex-direction: column; gap: 8px')}>
            <div style={s('display: flex; align-items: baseline; justify-content: space-between; padding: 0 4px')}>
              <h2 style={s('margin: 0; font-size: 15px; font-weight: 900')}>Sections</h2>
              {changed && <button type="button" onClick={() => setPicks({rank: null, bundles: {}})} style={s('border: none; background: transparent; color: #8C1D2B; font-size: 13px; font-weight: 800; cursor: pointer; padding: 4px')}>Reset to DIG’s pick</button>}
            </div>
            {selected.map((entry) => {
              const list = choices[entry.course_id] ?? [];
              const c = tone(entry.course_id);
              const original = option?.result.selected.find((item) => item.course_id === entry.course_id)?.bundle_id;
              const times = sectionTimes(entry.meetings);
              return (
                <div key={entry.course_id} style={s('min-height: 58px; padding: 8px 8px 8px 14px; box-sizing: border-box; border-radius: 18px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); display: flex; align-items: center; gap: 10px')}>
                  <span aria-hidden="true" style={s(`width: 12px; height: 12px; border-radius: 6px; flex-shrink: 0; background: ${c.bg}; border: 1.5px solid ${c.fg}`)} />
                  <span style={s('flex-shrink: 0; font-size: 15px; font-weight: 900')}>{shortCode(entry.course_code)}</span>
                  {list.length > 1 ? (
                    <label className="press" style={s('position: relative; flex: 1; min-width: 0; height: 42px; padding: 0 10px 0 12px; border-radius: 14px; background: #F1EEEA; display: flex; align-items: center; gap: 6px; cursor: pointer')}>
                      <span style={s('flex: 1; min-width: 0; font-size: 13px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{times}</span>
                      <span style={s('flex-shrink: 0; font-size: 12px; font-weight: 800; color: #6E6863')}>{list.findIndex((section) => section.bundle_id === entry.bundle_id) + 1}/{list.length}</span>
                      <Svg size={14} sw={2.8}>{ICON.down}</Svg>
                      <select className="dg-native" aria-label={`${entry.course_code} section, ${times}`} value={entry.bundle_id} onChange={(event) => pick(entry.course_id, event.target.value)}>
                        {list.map((section) => <option key={section.bundle_id} value={section.bundle_id}>{sectionTimes(section.meetings)}{section.bundle_id === original ? ' · DIG’s pick' : ''}{section.seat_status === 'full' ? ' · Full' : ''}</option>)}
                      </select>
                    </label>
                  ) : (
                    <span style={s('flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: #5F5A55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{times} · only section that fits</span>
                  )}
                </div>
              );
            })}
            {clash && <span role="alert" style={s('display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 14px; background: #FCEFD2; color: #6B4500; font-size: 13px; font-weight: 800')}><Svg size={16} sw={2.4} style={s('flex-shrink: 0')}>{ICON.warn}</Svg>{shortCode(clash.codes[0])} and {shortCode(clash.codes[1])} overlap on {DAY_SHORT[dayIndex(clash.day)]}. Pick another section to save.</span>}
          </section>
        )}
      </main>

      <div style={s('flex-shrink: 0; padding: 10px 20px 26px; display: flex; flex-direction: column; align-items: center; gap: 10px; background: #FFFFFF; border-radius: 28px 28px 0 0; box-shadow: 0 -6px 24px rgba(40,20,20,0.06)')}>
        <button type="button" onClick={() => void save()} aria-live="polite" aria-disabled={!!clash} style={s(`height: 58px; border: none; border-radius: 29px; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; overflow: hidden; white-space: nowrap; transition: width 380ms cubic-bezier(.2,.9,.25,1.1), background 300ms ease, box-shadow 300ms ease; cursor: ${phase === 'idle' && !clash ? 'pointer' : 'default'}; ${phase === 'idle' ? `width: 100%; background: ${clash ? '#B9AFA6' : '#8C1D2B'}; color: #FFFFFF; box-shadow: ${clash ? 'none' : '0 8px 20px rgba(140,29,43,0.30)'}` : phase === 'planting' ? 'width: 58px; background: #8C1D2B; color: #FFFFFF; box-shadow: 0 4px 12px rgba(140,29,43,0.30)' : 'width: 100%; background: #1D1B1A; color: #FFFFFF; box-shadow: none'}`)}>
          {phase === 'idle' && <span style={s('display: flex; align-items: center; gap: 10px')}><Spade fill="#FFFFFF" style="height: 24px; width: 9px" />Save Plan</span>}
          {phase === 'planting' && <Spade className="digging" label="Saving" fill="#FFFFFF" style="height: 28px; width: 11px" />}
          {phase === 'saved' && <span className="pop" style={s('display: flex; align-items: center; gap: 8px')}><Svg size={20} sw={3}>{ICON.check}</Svg>Planted in Plans</span>}
        </button>
        {phase === 'saved'
          ? <Link href={`/?term=${encodeURIComponent(term)}&view=plans`} className="pop" style={s('min-height: 32px; display: flex; align-items: center; gap: 4px; font-size: 15px; font-weight: 800; color: #8C1D2B; text-decoration: none; animation-delay: 120ms')}>View in Schedule<Svg size={16} sw={2.8}>{ICON.arrow}</Svg></Link>
          : <span role={error ? 'alert' : undefined} style={s(`min-height: 32px; display: flex; align-items: center; font-size: 13px; font-weight: 700; color: ${error ? '#8C1D2B' : '#5F5A55'}`)}>{error ?? (currentLabel ? `Your enrolled ${currentLabel} schedule won’t change.` : 'Your enrolled schedule won’t change.')}</span>}
      </div>
    </Frame>
  );
}

export default function SchedulePreviewPage() {
  return <Suspense fallback={<Frame css={CSS} numeric><span /></Frame>}><SchedulePreview /></Suspense>;
}
