'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import {BackLink, Frame, ICON, Spade, Svg} from '@/components/dg';
import {DayHeads, HourAxis, dayColumn, gridHours} from '@/components/week';
import {currentTermOf, useBuildingNames, useTerms} from '@/lib/data/catalog';
import {digTerm, useDigRun} from '@/lib/data/dig-session';
import {savePlannedSchedule} from '@/lib/data/saved-schedules';
import {campusDays, describeOptions} from '@/lib/dig-view';
import {IS_MOCK} from '@/lib/supabase';
import {s} from '@/lib/ui/css';
import {WEEKDAYS, plural, shortCode, shortPlace} from '@/lib/ui/format';
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
  const selected = option?.result.selected ?? [];
  const {start, end} = gridHours(selected.flatMap((entry) => entry.meetings));
  const off = run ? run.conditions.days.flatMap((on, day) => (on ? [] : [day])) : [];
  const blocks = WEEKDAYS.flatMap((day) => selected.flatMap((entry) => entry.meetings.filter((meeting) => meeting.day === day).map((meeting) => ({entry, meeting, day}))));
  const currentLabel = terms.find((item) => item.id === currentTermOf(terms))?.label;

  async function save() {
    if (phase !== 'idle' || !run?.data || !option) return;
    if (run.data.sample && !IS_MOCK) return setError('Sample results can’t be saved to your account.');
    setPhase('planting');
    setError(null);
    try {
      // The save and the digging animation run together; the button reports back when both are done.
      const planted = new Promise<void>((resolve) => {
        timer.current = window.setTimeout(resolve, PLANTING_MS);
      });
      await Promise.all([savePlannedSchedule({term: run.term, selected: option.result.selected}, run.data.request_id), planted]);
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
          <span style={s('font-size: 14px; font-weight: 700; color: #5F5A55')}>{option ? `${plural(option.credits, 'credit')} · ${campusDays(option.result)} · ${option.walk ? `${option.walk} max walk` : 'walking time unverified'}` : ' '}</span>
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
                  <div key={`${block.entry.course_id}-${block.meeting.start_min}`} style={s(`position: absolute; left: 3px; right: 3px; top: ${(block.meeting.start_min / 60 - start) * H}px; height: ${((block.meeting.end_min - block.meeting.start_min) / 60) * H - 3}px; box-sizing: border-box; padding: 5px 7px; border-radius: 12px; color: ${c.fg}; overflow: hidden; animation: drop 620ms cubic-bezier(.2,.9,.25,1) both; animation-delay: ${160 + blocks.indexOf(block) * 70}ms; ${added ? `background: ${c.light}; border: 1.5px dashed ${c.fg}` : `background: ${c.bg}`}`)}>
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
      </main>

      <div style={s('flex-shrink: 0; padding: 10px 20px 26px; display: flex; flex-direction: column; align-items: center; gap: 10px; background: #FFFFFF; border-radius: 28px 28px 0 0; box-shadow: 0 -6px 24px rgba(40,20,20,0.06)')}>
        <button type="button" onClick={() => void save()} aria-live="polite" style={s(`height: 58px; border: none; border-radius: 29px; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; overflow: hidden; white-space: nowrap; transition: width 380ms cubic-bezier(.2,.9,.25,1.1), background 300ms ease, box-shadow 300ms ease; cursor: ${phase === 'idle' ? 'pointer' : 'default'}; ${phase === 'idle' ? 'width: 100%; background: #8C1D2B; color: #FFFFFF; box-shadow: 0 8px 20px rgba(140,29,43,0.30)' : phase === 'planting' ? 'width: 58px; background: #8C1D2B; color: #FFFFFF; box-shadow: 0 4px 12px rgba(140,29,43,0.30)' : 'width: 100%; background: #1D1B1A; color: #FFFFFF; box-shadow: none'}`)}>
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
