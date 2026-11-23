'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import {BackLink, Frame, ICON, Spade, Svg} from '@/components/dg';
import {Sheet} from '@/components/sheet';
import {PreviewClassDetails, type PreviewClass} from '@/components/preview-class-details';
import {DayHeads, HourAxis, dayColumn, gridHours} from '@/components/week';
import {currentTermOf, useBuildingNames, useTerms} from '@/lib/data/catalog';
import {digTerm, useDigRun} from '@/lib/data/dig-session';
import {deletePlannedSchedule, planLabel, PlanLimitError, PLAN_LIMIT, savePlannedSchedule, usePlannedScheduleState, type StoredPlan} from '@/lib/data/saved-schedules';
import {campusDays, describeOptions} from '@/lib/dig-view';
import {IS_MOCK} from '@/lib/supabase';
import {s} from '@/lib/ui/css';
import {WEEKDAYS, meetingSummary, plural, shortCode, shortPlace} from '@/lib/ui/format';
import {DIG_TONES} from '@/lib/ui/palette';
import {scheduleUrl} from '@/lib/schedule-view';

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
const hoursBetween = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 30) / 2} h`);
const ROUND = (on: boolean) => `width: 44px; height: 44px; flex-shrink: 0; border: none; border-radius: 22px; display: flex; align-items: center; justify-content: center; cursor: ${on ? 'pointer' : 'default'}; ${on ? 'background: #1D1B1A; color: #FFFFFF' : 'background: #ECE8E3; color: #A59D94'}`;
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
  const [classDetail, setClassDetail] = useState<PreviewClass | null>(null);
  const [planLimit, setPlanLimit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const savedPlans = usePlannedScheduleState(term);
  const saving = useRef(false);
  // Which timetable of the option on screen is shown: 0 is DIG's pick.
  const [shown, setShown] = useState<{rank: number | null; index: number}>({rank: null, index: 0});
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
  const pages = option ? run?.data?.timetables?.[option.rank] : undefined;
  const timetables = pages?.options ?? [];
  const index = shown.rank === option?.rank ? Math.min(shown.index, Math.max(0, timetables.length - 1)) : 0;
  const timetable = timetables[index];
  const selected = (option?.result.selected ?? []).map((entry, i) => {
    const id = timetable?.bundles[i];
    const other = id && id !== entry.bundle_id ? choices[entry.course_id]?.find((section) => section.bundle_id === id) : undefined;
    return other ? {...entry, bundle_id: other.bundle_id, meetings: other.meetings} : entry;
  });
  const walkText = index === 0 || !timetable ? (option?.walk ? `${option.walk} max walk` : 'walking time unverified') : timetable.maxWalk === null ? 'walking time unverified' : `${timetable.maxWalk} min max walk`;
  const go = (next: number) => {
    if (!option || next < 0 || next >= timetables.length) return;
    setShown({rank: option.rank, index: next});
    setClassDetail(null);
    setPhase('idle');
    setError(null);
  };
  const {start, end} = gridHours(selected.flatMap((entry) => entry.meetings));
  const off = run ? run.conditions.days.flatMap((on, day) => (on ? [] : [day])) : [];
  const blocks = WEEKDAYS.flatMap((day) => selected.flatMap((entry) => entry.meetings.filter((meeting) => meeting.day === day).map((meeting) => ({entry, meeting, day}))));
  const currentLabel = terms.find((item) => item.id === currentTermOf(terms))?.label;

  async function save() {
    if (saving.current || phase !== 'idle' || !run?.data || !option) return;
    if (run.data.sample && !IS_MOCK) return setError('Sample results can’t be saved to your account.');
    if (savedPlans.plans.length >= PLAN_LIMIT) {setPlanLimit(true); return;}
    saving.current = true;
    setPhase('planting');
    setError(null);
    try {
      // The save and the digging animation run together; the button reports back when both are done.
      const planted = new Promise<void>((resolve) => {
        timer.current = window.setTimeout(resolve, PLANTING_MS);
      });
      const [id] = await Promise.all([savePlannedSchedule({term: run.term, selected}, run.data.request_id), planted]);
      setPhase('saved');
      router.push(scheduleUrl('plans', run.term, currentTermOf(terms), id));
    } catch (failure) {
      setPhase('idle');
      if (failure instanceof PlanLimitError) {setPlanLimit(true); return;}
      setError(failure instanceof Error ? failure.message : 'Couldn’t save the plan. Try again.');
    } finally {saving.current = false;}
  }

  async function deletePlan(plan: StoredPlan) {
    if (deleting) return;
    setDeleting(true); setError(null);
    try {await deletePlannedSchedule(plan);}
    catch {setError('Couldn’t delete the plan. Try again.');}
    finally {setDeleting(false);}
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
          <span style={s('font-size: 14px; font-weight: 700; color: #5F5A55')}>{option ? `${plural(option.credits, 'credit')} · ${campusDays({...option.result, selected})} · ${walkText}` : ' '}</span>
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
                    <button type="button" aria-label={`${shortCode(block.entry.course_code)}, ${block.meeting.day}, ${sectionTimes([block.meeting])}`} onClick={() => setClassDetail({...block.entry, meeting: block.meeting})} style={s('position: absolute; inset: 0; z-index: 1; border: none; background: transparent; cursor: pointer')} />
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
          <section aria-label="Timetables" style={s('margin: 6px 0 0 8px; display: flex; flex-direction: column; gap: 8px')}>
            {timetables.length > 1 && (
              <div style={s('height: 56px; padding: 0 6px; border-radius: 20px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); display: flex; align-items: center; gap: 8px')}>
                <button type="button" className="press" aria-label="Previous timetable" disabled={index === 0} onClick={() => go(index - 1)} style={s(ROUND(index > 0))}><Svg size={20} sw={2.8}><path d="m15 18-6-6 6-6" /></Svg></button>
                <div aria-live="polite" style={s('flex: 1; display: flex; flex-direction: column; align-items: center')}>
                  <span style={s('font-size: 15px; font-weight: 900')}>Timetable {index + 1} of {timetables.length}</span>
                  <span style={s('font-size: 12px; font-weight: 700; color: #6E6863')}>{index === 0 ? 'DIG’s pick' : `${plural(timetable.campusDays, 'day')} on campus · ${hoursBetween(timetable.idleMinutes)} between classes`}</span>
                </div>
                <button type="button" className="press" aria-label="Next timetable" disabled={index >= timetables.length - 1} onClick={() => go(index + 1)} style={s(ROUND(index < timetables.length - 1))}><Svg size={20} sw={2.8}>{ICON.right}</Svg></button>
              </div>
            )}
            {timetables.length === 1 && <span style={s('padding: 0 4px; font-size: 13px; font-weight: 700; color: #6E6863')}>This is the only timetable these courses fit into.</span>}
            {selected.map((entry) => {
              const c = tone(entry.course_id);
              return (
                <div key={entry.course_id} style={s('min-height: 46px; padding: 8px 14px; box-sizing: border-box; border-radius: 16px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); display: flex; align-items: center; gap: 10px')}>
                  <span aria-hidden="true" style={s(`width: 12px; height: 12px; border-radius: 6px; flex-shrink: 0; background: ${c.bg}; border: 1.5px solid ${c.fg}`)} />
                  <span style={s('flex-shrink: 0; font-size: 14px; font-weight: 900')}>{shortCode(entry.course_code)}</span>
                  <span style={s('flex: 1; min-width: 0; text-align: right; font-size: 13px; font-weight: 700; color: #5F5A55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{sectionTimes(entry.meetings)}</span>
                </div>
              );
            })}
          </section>
        )}
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
      {classDetail && <PreviewClassDetails key={`${term}:${classDetail.course_id}:${classDetail.bundle_id}:${classDetail.meeting.day}:${classDetail.meeting.start_min}`} term={term} entry={classDetail} onDismiss={() => setClassDetail(null)} />}
      {planLimit && <Sheet title={savedPlans.plans.length >= PLAN_LIMIT ? '3 plans saved' : 'Ready to save'} onDismiss={() => setPlanLimit(false)}>
        <p style={s('line-height: 1.5')}>{savedPlans.plans.length >= PLAN_LIMIT ? `You can keep up to 3 plans for ${run?.termLabel}. Delete one below to save this timetable.` : 'A plan slot is available. Save this timetable to keep it with your other plans.'}</p>
        <div style={s('display: grid; gap: 10px')}>
          {savedPlans.plans.map(plan => <div key={plan.id} style={s('background: #F7F5F2; padding: 12px; border-radius: 14px; display: flex; gap: 8px; align-items: center')}>
            <span style={s('flex: 1; line-height: 1.5')}><strong>{planLabel(plan)}</strong> · {plan.selected.reduce((sum, item) => sum + item.credits, 0)} cr<br /><span style={s('font-size: 12px')}>{plan.selected.map(item => shortCode(item.course_code)).join(', ')}</span></span>
            <button type="button" disabled={deleting} onClick={() => void deletePlan(plan)} style={s('min-height: 44px; border: none; padding: 10px; border-radius: 12px; color: #8C1D2B; font-weight: 800; cursor: pointer')}>Delete {planLabel(plan)}</button>
          </div>)}
        </div>
        {error && <p role="alert">{error}</p>}
        {savedPlans.plans.length < PLAN_LIMIT && <button type="button" disabled={deleting} onClick={() => {setPlanLimit(false); void save();}} style={s('margin-top: 16px; width: 100%; min-height: 48px; border: none; border-radius: 16px; background: #8C1D2B; color: white; font-weight: 800; cursor: pointer')}>Save this plan</button>}
      </Sheet>}
    </Frame>
  );
}

export default function SchedulePreviewPage() {
  return <Suspense fallback={<Frame css={CSS} numeric><span /></Frame>}><SchedulePreview /></Suspense>;
}
