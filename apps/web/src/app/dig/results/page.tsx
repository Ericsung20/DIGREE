'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState, type PointerEvent} from 'react';
import {BackLink, Frame, ICON, Spade, Svg, TabBar} from '@/components/dg';
import {useBuildingNames, useTerms} from '@/lib/data/catalog';
import {cancelDig, digTerm, saveDigConditions, setDigIndex, startDig, useDigRun, type DigRun} from '@/lib/data/dig-session';
import {blockers, conditionsChip, describeOptions, loosenChoices, majorPreferenceNotice, type DigOption} from '@/lib/dig-view';
import {s} from '@/lib/ui/css';
import {DAY_LETTERS, WEEKDAYS, courseList, plural} from '@/lib/ui/format';
import {DIG_TONES} from '@/lib/ui/palette';

const CSS = `
button{font:inherit}
`;

// The card's mini week shows 8 AM to 5 PM in 150px.
const H = 150 / 9;
const top = (min: number) => Math.max(0, Math.min(150, (min / 60 - 8) * H));
const BIG_BUTTON = 'height: 58px; border: none; border-radius: 22px; background: #8C1D2B; color: #FFFFFF; font-size: 18px; font-weight: 900; cursor: pointer; box-shadow: 0 8px 20px rgba(140,29,43,0.30)';

/** The swipeable stack of options. */
function Deck({run, options, term}: {run: DigRun; options: DigOption[]; term: string}) {
  const [idx, setIdx] = useState(Math.min(run.index, options.length - 1));
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [moved, setMoved] = useState(false);
  const [ready, setReady] = useState(false); // false for one frame, so the cards rise in from below
  const drag = useRef<{x: number} | null>(null);
  const n = options.length;
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(timer);
  }, []);
  const go = (next: number) => {
    setIdx(next);
    setMoved(true);
    setDigIndex(next);
  };

  // One color per course across the deck: must-takes first, then whatever DIG added.
  const required = run.mustTake.map((course) => course.id);
  const order = [...required, ...options.flatMap((option) => option.result.selected.map((entry) => entry.course_id))].filter((id, i, all) => all.indexOf(id) === i);
  const tone = (courseId: string) => DIG_TONES[order.indexOf(courseId) % DIG_TONES.length];
  const roundBtn = (on: boolean) => `width: 52px; height: 52px; border: none; border-radius: 26px; display: flex; align-items: center; justify-content: center; cursor: ${on ? 'pointer' : 'default'}; transition: opacity 200ms ease; ${on ? 'background: #FFFFFF; color: #1D1B1A; box-shadow: 0 2px 8px rgba(40,20,20,0.10); opacity: 1' : 'background: #ECE8E3; color: #8A847E; opacity: 0.6'}`;

  return (
    <>
      <div style={s('position: relative; height: 524px; margin: 6px 20px 0')}>
        {options.map((o, i) => {
          const k = i - idx;
          let t: string, op: number, z: number, delay = moved ? 0 : Math.max(k, 0) * 90;
          if (!ready) { t = `translateY(640px) rotate(${i % 2 ? 5 : -5}deg)`; op = 0; z = 10 - i; }
          else if (k < 0) { t = 'translateX(-140%) rotate(-14deg)'; op = 0; z = 11; delay = 0; }
          else if (k === 0) { t = `translateX(${dx}px) rotate(${dx / 16}deg)`; op = 1; z = 10; }
          else if (k === 1) { t = 'translateY(16px) scale(0.95)'; op = 1; z = 9; }
          else if (k === 2) { t = 'translateY(32px) scale(0.9)'; op = 0.7; z = 8; }
          else { t = 'translateY(32px) scale(0.9)'; op = 0; z = 7; }
          const tr = dragging && k === 0 ? 'none' : ready ? `transform 560ms cubic-bezier(.2,.9,.25,1.12) ${delay}ms, opacity 320ms ease ${delay}ms` : 'transform 300ms ease-in, opacity 200ms ease';
          const down = (event: PointerEvent<HTMLDivElement>) => {
            if (i !== idx) return;
            if ((event.target as Element).closest?.('a')) return;
            drag.current = {x: event.clientX};
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
            setDragging(true);
            setDx(0);
          };
          const move = (event: PointerEvent<HTMLDivElement>) => {
            if (drag.current) setDx(event.clientX - drag.current.x);
          };
          const up = () => {
            if (!drag.current) return;
            drag.current = null;
            let j = idx;
            if (dx < -70 && j < n - 1) j = j + 1;
            else if (dx > 70 && j > 0) j = j - 1;
            setDragging(false);
            setDx(0);
            go(j);
          };
          return (
            <div key={o.rank} role="group" aria-label={`Option ${i + 1}, ${plural(o.credits, 'credit')}`} aria-hidden={k !== 0} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              style={s(`position: absolute; left: 0; right: 0; top: 0; height: 488px; box-sizing: border-box; padding: 20px; background: #FFFFFF; border-radius: 30px; box-shadow: 0 1px 2px rgba(40,20,20,0.05), 0 14px 36px rgba(40,20,20,0.09); display: flex; flex-direction: column; gap: 16px; touch-action: pan-y; user-select: none; cursor: ${k === 0 ? (dragging ? 'grabbing' : 'grab') : 'default'}; transform-origin: 50% 100%; transform: ${t}; opacity: ${op}; z-index: ${z}; transition: ${tr}; pointer-events: ${k === 0 && ready ? 'auto' : 'none'}`)}>
              <div style={s('display: flex; align-items: flex-start; justify-content: space-between')}>
                <div style={s('display: flex; flex-direction: column; gap: 6px; padding-top: 4px')}>
                  <span style={s('font-size: 14px; font-weight: 800; color: #5F5A55')}>Option {i + 1}</span>
                  {o.tag && <span style={s('align-self: flex-start; height: 26px; padding: 0 10px; border-radius: 13px; background: #1D1B1A; color: #FFFFFF; font-size: 12px; font-weight: 800; display: inline-flex; align-items: center')}>{o.tag}</span>}
                </div>
                <span style={s('font-size: 44px; font-weight: 900; letter-spacing: -0.03em; line-height: 1')}>{o.credits}<span style={s('font-size: 16px; font-weight: 800; color: #5F5A55; letter-spacing: 0')}> cr</span></span>
              </div>

              <div aria-hidden="true" style={s('display: flex; flex-direction: column; gap: 6px')}>
                <div style={s('display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; height: 150px')}>
                  {WEEKDAYS.map((day) => (
                    <div key={day} style={s('position: relative; border-radius: 12px; background: #F4F1ED')}>
                      {o.result.selected.flatMap((entry) => entry.meetings.filter((meeting) => meeting.day === day).map((meeting) => {
                        const c = tone(entry.course_id);
                        return <span key={`${entry.course_id}-${meeting.start_min}`} style={s(`position: absolute; left: 3px; right: 3px; top: ${top(meeting.start_min)}px; height: ${Math.max(4, top(meeting.end_min) - top(meeting.start_min) - 2)}px; box-sizing: border-box; border-radius: 6px; ${required.includes(entry.course_id) ? `background: ${c.bg}` : `background: ${c.light}; border: 1.5px dashed ${c.fg}`}`)} />;
                      }))}
                    </div>
                  ))}
                </div>
                <div style={s('display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; font-size: 12px; font-weight: 800; color: #6E6863; text-align: center')}>
                  {DAY_LETTERS.map((letter, day) => <span key={day}>{letter}</span>)}
                </div>
              </div>

              {o.added.length > 0 && (
                <div style={s('display: flex; align-items: center; gap: 6px; flex-wrap: wrap')}>
                  <span style={s('font-size: 12px; font-weight: 800; color: #5F5A55; margin-right: 2px')}>DIG added</span>
                  {o.added.map((code) => <span key={code} style={s('height: 30px; padding: 0 10px; box-sizing: border-box; border-radius: 15px; border: 2px dashed #C9C3BC; font-size: 13px; font-weight: 800; display: inline-flex; align-items: center')}>{code}</span>)}
                </div>
              )}

              <div style={s('display: flex; flex-direction: column; gap: 8px; font-size: 14px; font-weight: 700')}>
                <div style={s('display: flex; align-items: center; justify-content: space-between')}>
                  {o.walk
                    ? <span style={s('display: flex; align-items: center; gap: 6px')}><Svg size={18} sw={2.2} stroke="#5F5A55">{ICON.walk}</Svg><span><strong style={s('font-weight: 900')}>{o.walk}</strong> max walk</span></span>
                    : <span style={s('height: 30px; padding: 0 12px; border-radius: 15px; background: #FCEFD2; color: #6B4500; display: inline-flex; align-items: center; gap: 6px; font-weight: 800')}><Svg size={16} sw={2.2}>{ICON.walk}</Svg>Walking time unverified</span>}
                  {!o.check && o.walk && <span style={s('display: flex; align-items: center; gap: 4px; color: #5F5A55')}><Svg size={16} sw={2.8}>{ICON.check}</Svg>All clear</span>}
                </div>
                {o.check && <span style={s('display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 14px; background: #FCEFD2; color: #6B4500; font-size: 13px; font-weight: 800')}><Svg size={16} sw={2.4} style={s('flex-shrink: 0')}>{ICON.warn}</Svg>{o.check}</span>}
              </div>

              <Link href={`/dig/preview?term=${encodeURIComponent(term)}&option=${o.rank}`} draggable={false} tabIndex={k === 0 ? 0 : -1} style={s('margin-top: auto; height: 54px; border-radius: 20px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 16px; font-weight: 900')}>Preview<Svg size={18} sw={2.8}>{ICON.arrow}</Svg></Link>
            </div>
          );
        })}
      </div>

      <div style={s(`height: 60px; margin: 18px 20px 0; display: flex; align-items: center; justify-content: space-between; transition: opacity 300ms ease 300ms; opacity: ${ready ? 1 : 0}`)}>
        <button type="button" aria-label="Previous option" onClick={() => idx > 0 && go(idx - 1)} style={s(roundBtn(idx > 0))}><Svg size={22} sw={2.8}><path d="m15 18-6-6 6-6" /></Svg></button>
        <div aria-label={`Option ${idx + 1} of ${n}`} style={s('display: flex; align-items: center; gap: 6px')}>
          {options.map((o, i) => <span key={o.rank} style={s(`height: 8px; border-radius: 4px; transition: width 300ms cubic-bezier(.2,.9,.25,1.2), background 300ms ease; ${i === idx ? 'width: 24px; background: #1D1B1A' : 'width: 8px; background: #CFC9C2'}`)} />)}
        </div>
        <button type="button" aria-label="Next option" onClick={() => idx < n - 1 && go(idx + 1)} style={s(roundBtn(idx < n - 1))}><Svg size={22} sw={2.8}>{ICON.right}</Svg></button>
      </div>
    </>
  );
}

/** The cross-section of soil the spade works down through while the optimizer runs. */
function Digging({run, digging, onCancel}: {run: DigRun | null; digging: boolean; onCancel: () => void}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!digging) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 380);
    return () => window.clearInterval(timer);
  }, [digging]);
  const step = Math.min(2, Math.floor(tick / 2));
  const wig = tick % 2 === 0;
  const layers = ['Finding sections', `Filling to ${plural(run?.conditions.credits ?? 0, 'credit')}`, 'Measuring walks'];
  const tones = ['#F1ECE6', '#E8E0D7', '#DED4C9'];
  const spTop = 22 + step * 84 + (wig ? 8 : 0);
  const dirt = (x: number, y: number, size: number, show: boolean) => `position: absolute; left: ${42 + x}px; top: ${spTop + 58 + y}px; width: ${size}px; height: ${size}px; border-radius: 50%; background: #8A7563; transition: top 420ms cubic-bezier(.2,.9,.25,1), opacity 200ms ease, transform 300ms ease; opacity: ${show ? 0.9 : 0}; transform: translateY(${show ? -10 : 0}px)`;
  return (
    <div role="status" aria-label="Digging progress" aria-hidden={!digging} style={s(`position: absolute; left: 20px; right: 20px; top: 20px; display: flex; flex-direction: column; gap: 18px; transition: opacity 300ms ease, transform 400ms cubic-bezier(.2,.9,.25,1); ${digging ? 'opacity: 1; transform: none; pointer-events: auto' : 'opacity: 0; transform: translateY(-16px) scale(0.98); pointer-events: none'}`)}>
      <div style={s('position: relative; border-radius: 28px; overflow: hidden; background: #FFFFFF; box-shadow: 0 12px 32px rgba(40,20,20,0.08)')}>
        <div style={s('height: 64px; background: #FFFFFF')} />
        <div style={s('height: 3px; background: #1D1B1A; opacity: 0.85')} />
        {layers.map((label, i) => {
          const done = i < step, cur = i === step;
          return (
            <div key={i} style={s(`height: 84px; box-sizing: border-box; padding-left: 92px; display: flex; align-items: center; gap: 12px; background: ${tones[i]}`)}>
              <span style={s(`width: 24px; height: 24px; box-sizing: border-box; border-radius: 12px; display: flex; align-items: center; justify-content: center; transition: background 250ms ease; ${done ? 'background: #1D1B1A' : cur ? 'border: 3px solid #1D1B1A' : 'border: 2px solid #A59D94'}`)}>
                {done && <Svg size={14} sw={3.4} stroke="#FFFFFF">{ICON.check}</Svg>}
              </span>
              <span style={s(`font-size: 16px; transition: color 250ms ease; ${cur ? 'font-weight: 900; color: #1D1B1A' : done ? 'font-weight: 800; color: #1D1B1A' : 'font-weight: 700; color: #4E4945'}`)}>{label}</span>
            </div>
          );
        })}
        <Spade fill="#8C1D2B" style={`position: absolute; left: 34px; top: ${spTop}px; width: 24px; height: 62px; transform-origin: 50% 85%; transform: rotate(${wig ? -16 : 8}deg); transition: top 420ms cubic-bezier(.2,.9,.25,1), transform 260ms cubic-bezier(.3,1.4,.5,1)`} />
        <span aria-hidden="true" style={s(dirt(-14, 0, 7, wig))} />
        <span aria-hidden="true" style={s(dirt(22, -6, 5, wig))} />
        <span aria-hidden="true" style={s(dirt(28, 4, 6, !wig))} />
      </div>
      {digging && <button type="button" onClick={onCancel} style={s('align-self: center; height: 44px; padding: 0 22px; border: none; border-radius: 22px; background: #ECE8E3; color: #1D1B1A; text-decoration: none; font-size: 15px; font-weight: 800; display: flex; align-items: center; cursor: pointer')}>Cancel</button>}
    </div>
  );
}

function Recommendations() {
  const params = useSearchParams();
  const router = useRouter();
  const terms = useTerms();
  const run = useDigRun();
  const term = run?.term ?? digTerm(terms, params.get('term'));
  const setup = `/dig?term=${encodeURIComponent(term)}`;
  const [loosen, setLoosen] = useState(0);

  // Nothing to show after a reload: the run lives in memory. The conditions are saved, so go back to them.
  const missing = run === null && terms.length > 0;
  useEffect(() => {
    if (!missing) return;
    const timer = window.setTimeout(() => router.replace(setup), 60);
    return () => window.clearTimeout(timer);
  }, [missing, router, setup]);

  const results = run?.data?.results ?? [];
  const names = useBuildingNames(results.flatMap((result) => result.selected.flatMap((entry) => entry.meetings.flatMap((meeting) => (meeting.building_id ? [meeting.building_id] : [])))));
  const options = run?.data ? describeOptions(run.data, run.conditions, run.mustTake.map((course) => course.id), (id) => names[id] ?? id) : [];
  const digging = !run || run.digging;
  const isEmpty = !digging && !!run.data && options.length === 0;
  const isError = !digging && !!run.failure;
  const truncated = run?.data?.diagnostics.search_truncated;
  const mustCredits = run?.mustTake.reduce((total, course) => total + course.credits, 0) ?? 0;
  const choices = run ? loosenChoices(run.conditions, mustCredits) : [];
  const unverified = options.filter((option) => !option.walk).length;

  let title: string, sub: string;
  if (digging) { title = 'Digging…'; sub = run?.mustTake.length ? `Checking every section of ${courseList(run.mustTake.map((course) => course.code))}` : ' '; }
  else if (isEmpty) { const count = run.data!.diagnostics.no_results_reasons.length; title = 'Nothing fits yet'; sub = truncated ? 'DIG reached its search limit before finding a match' : count === 1 ? 'One condition blocks every combination' : count ? `${count} conditions block every combination` : 'No combination meets your conditions'; }
  else if (isError) { title = run.failure!.kind === 'validation' ? 'Can’t dig yet' : 'Couldn’t reach DIG'; sub = 'Your conditions are saved'; }
  else { title = `${plural(options.length, 'schedule')} dug up`; sub = truncated ? 'Best results found within the search limit' : unverified ? `${unverified} need${unverified === 1 ? 's' : ''} a walking check · swipe to compare` : options.length > 1 ? 'Swipe to compare' : 'Preview it, then save it'; }

  const again = (conditions = run?.conditions) => {
    if (!run || !conditions) return;
    saveDigConditions(conditions);
    setLoosen(0);
    startDig({term: run.term, termLabel: run.termLabel, conditions, mustTake: run.mustTake, mock: null});
  };

  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 8px 20px 8px 10px; display: flex; flex-direction: column; gap: 6px')}>
        <div style={s('display: flex; align-items: center; gap: 4px; height: 44px')}>
          <BackLink href={setup} label="Back to conditions" />
          {run && <Link href={setup} style={s('height: 32px; padding: 0 12px; border-radius: 16px; background: #ECE8E3; color: #3D3936; text-decoration: none; font-size: 13px; font-weight: 800; display: flex; align-items: center')}>{conditionsChip(run.termLabel, run.conditions)}</Link>}
        </div>
        <div style={s('padding-left: 10px; display: flex; flex-direction: column; gap: 2px')}>
          <h1 style={s('margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>{title}</h1>
          <p style={s('margin: 0; font-size: 14px; font-weight: 700; color: #5F5A55')}>{sub}</p>
        </div>
        {run?.data && majorPreferenceNotice(run.data.majorPreference) && <span role="status" style={s('padding: 8px 10px; font-size: 12px; font-weight: 800; line-height: 1.5; color: #6B4500; background: #FCEFD2; border-radius: 12px')}>{majorPreferenceNotice(run.data.majorPreference)}</span>}
      </header>

      <main style={s('position: relative; flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto')}>
        {run && !digging && options.length > 0 && <Deck key={run.id} run={run} options={options} term={term} />}

        <Digging key={`digging-${run?.id ?? 0}`} run={run} digging={digging} onCancel={() => {
          cancelDig();
          router.replace(setup);
        }} />

        {isEmpty && (
          <div style={s('position: absolute; inset: 0; padding: 8px 20px 16px; display: flex; flex-direction: column; gap: 18px; overflow: auto')}>
            <svg aria-hidden="true" viewBox="0 0 200 110" style={s('width: 200px; height: 110px; align-self: center; flex-shrink: 0')}>
              <ellipse cx="100" cy="88" rx="86" ry="18" fill="#E6DED5" />
              <ellipse cx="100" cy="86" rx="56" ry="10" fill="#CFC5BA" />
              <g transform="translate(132 18) rotate(24)"><circle cx="10" cy="5.5" r="5" fill="#8C1D2B" /><rect x="6.5" y="14" width="7" height="20" rx="3.5" fill="#8C1D2B" /><path d="M2 30H18V37C18 43 14 47.5 10 51C6 47.5 2 43 2 37Z" fill="#8C1D2B" stroke="#8C1D2B" strokeWidth="2" strokeLinejoin="round" /></g>
            </svg>
            <div style={s('display: flex; flex-direction: column; gap: 8px')}>
              {blockers(run.data!.diagnostics.no_results_reasons, run.conditions, run.mustTake.map((course) => course.code)).slice(0, 3).map((reason, i) => (
                <div key={i} style={s('padding: 14px 16px; border-radius: 20px; background: #FFFFFF; display: flex; flex-direction: column; gap: 2px')}><span style={s('font-size: 14px; font-weight: 900')}>{reason.title}</span><span style={s('font-size: 14px; font-weight: 600; color: #5F5A55')}>{reason.body}</span></div>
              ))}
            </div>
            {choices.length > 0 && (
              <div style={s('display: flex; flex-direction: column; gap: 10px')}>
                <span style={s('font-size: 15px; font-weight: 800')}>Loosen one</span>
                <div style={s('display: flex; flex-wrap: wrap; gap: 8px')}>
                  {choices.map((choice, i) => {
                    const on = loosen === i;
                    return <button key={choice.label} type="button" aria-pressed={on} onClick={() => setLoosen(i)} style={s(`height: 44px; padding: 0 16px; border: none; border-radius: 22px; font-size: 14px; font-weight: 800; cursor: pointer; transition: background 220ms ease, color 220ms ease; ${on ? 'background: #1D1B1A; color: #FFFFFF' : 'background: #FFFFFF; color: #3D3936; box-shadow: 0 1px 3px rgba(40,20,20,0.08)'}`)}>{choice.label}</button>;
                  })}
                </div>
              </div>
            )}
            <button type="button" onClick={() => again(choices[loosen]?.apply(run.conditions))} style={s(`margin-top: auto; flex-shrink: 0; ${BIG_BUTTON}`)}>Dig again</button>
          </div>
        )}

        {isError && (
          <div style={s('position: absolute; inset: 0; padding: 8px 20px 16px; display: flex; flex-direction: column; gap: 18px')}>
            <div role="alert" style={s('flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center')}>
              <span style={s('width: 88px; height: 88px; border-radius: 44px; background: #ECE8E3; color: #3D3936; display: flex; align-items: center; justify-content: center')}>
                <Svg size={40} sw={2}><path d="m2 2 20 20" /><path d="M5.8 5.8A7 7 0 0 0 7.5 19h10a4.5 4.5 0 0 0 2.4-.7" /><path d="M21.5 15.4A4.5 4.5 0 0 0 17.5 10h-1.8a7 7 0 0 0-6.1-4.8" /></Svg>
              </span>
              <p style={s('margin: 0; max-width: 280px; font-size: 16px; font-weight: 600; line-height: 1.5; color: #5F5A55')}>{run.failure!.kind === 'validation' ? run.failure!.message ?? 'DIG couldn’t use these conditions. Change them and dig again.' : 'The DIG server didn’t answer. Nothing was lost, so you can dig again right away.'}</p>
            </div>
            {run.failure!.kind === 'validation'
              ? <Link href={setup} style={s(`${BIG_BUTTON}; display: flex; align-items: center; justify-content: center; text-decoration: none`)}>Edit conditions</Link>
              : <button type="button" onClick={() => again()} style={s(BIG_BUTTON)}>Try again</button>}
            <Link href="/" style={s('align-self: center; min-height: 44px; display: flex; align-items: center; color: #3D3936; font-size: 15px; font-weight: 800; text-decoration: none')}>Back to Schedule</Link>
          </div>
        )}
      </main>

      <TabBar active="dig" />
    </Frame>
  );
}

export default function RecommendationsPage() {
  return <Suspense fallback={<Frame css={CSS} numeric><span /></Frame>}><Recommendations /></Suspense>;
}
