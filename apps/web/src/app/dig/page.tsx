'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import {AvatarLink, Frame, ICON, Spade, Svg, TabBar} from '@/components/dg';
import {useCourseDetails, useTerms} from '@/lib/data/catalog';
import {removeCourseRecord, useCourseRecords} from '@/lib/data/course-records';
import {digTerm, saveDigConditions, startDig, useDigConditions, type MustTake} from '@/lib/data/dig-session';
import {CREDIT_LIMIT, type DigConditions} from '@/lib/dig-view';
import {IS_MOCK} from '@/lib/supabase';
import {s} from '@/lib/ui/css';
import {DAY_LETTERS, DAY_NAMES, hourLabel} from '@/lib/ui/format';
import fixture from '@/mocks/request.json';

const CSS = `
button,input{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 480ms cubic-bezier(.2,.9,.25,1) both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.94)}
.digbtn{transition:transform 160ms ease, box-shadow 200ms ease}
.digbtn:hover{box-shadow:0 12px 28px rgba(140,29,43,.38)}
.digbtn:active{transform:scale(.97)}
.digbtn:hover svg{animation:dig 650ms ease-in-out infinite}
@keyframes dig{0%,100%{transform:rotate(0)}30%{transform:rotate(-20deg) translateY(3px)}60%{transform:rotate(10deg) translateY(-1px)}}
.dg-range{-webkit-appearance:none;appearance:none;width:100%;height:32px;margin:0;background:transparent;cursor:pointer}
.dg-range::-webkit-slider-runnable-track{height:8px;border-radius:4px;background:#E4DFD9}
.dg-range::-webkit-slider-thumb{-webkit-appearance:none;width:30px;height:30px;margin-top:-11px;border-radius:15px;background:#1D1B1A;border:4px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,.22)}
.dg-range::-moz-range-track{height:8px;border-radius:4px;background:#E4DFD9}
.dg-range::-moz-range-thumb{width:22px;height:22px;border-radius:15px;background:#1D1B1A;border:4px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,.22)}
`;

const PREFER: {key: keyof DigConditions['prefer']; label: string}[] = [{key: 'walks', label: 'Short walks'}, {key: 'lunch', label: 'Lunch break'}, {key: 'days', label: 'Fewer days'}];
const HOUR_BUTTON = 'position: relative; flex: 1; height: 52px; border: none; border-radius: 18px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.08); color: #1D1B1A; font-size: 18px; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center';
const hours = (from: number, to: number) => Array.from({length: to - from + 1}, (_, i) => (from + i) * 60);
// Sample mode sends the shared fixture, so its required courses are the must-takes until the user adds their own.
const SAMPLE: MustTake[] = fixture.courses.filter((course) => course.is_required).map((course) => ({id: course.course_id, code: course.course_code, credits: course.credit_options[0]}));

function GenerateSetup() {
  const params = useSearchParams();
  const router = useRouter();
  const terms = useTerms();
  const term = digTerm(terms, params.get('term'));
  const termLabel = terms.find((item) => item.id === term)?.label ?? '';
  const conditions = useDigConditions();
  const records = useCourseRecords();
  const planned = records.filter((record) => record.term === term && record.status === 'planned');
  const details = useCourseDetails(planned.map((record) => record.course_id));
  const [bump, setBump] = useState(false);
  const bumpTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(bumpTimer.current), []);

  const own: (MustTake & {record: string})[] = planned.map((record) => ({id: record.course_id, code: record.course_code ?? details[record.course_id]?.code ?? record.course_id, credits: record.credits, record: record.id}));
  const mustTake: (MustTake & {record?: string})[] = own.length || !IS_MOCK ? own : SAMPLE;
  const mustCredits = mustTake.reduce((total, course) => total + course.credits, 0);
  const min = Math.min(Math.max(mustCredits, 1), CREDIT_LIMIT);
  const max = Math.max(CREDIT_LIMIT, mustCredits);
  const credits = Math.min(max, Math.max(min, conditions.credits));
  const fill = Math.max(0, credits - mustCredits);
  const mustPct = Math.round((Math.min(mustCredits, credits) / credits) * 100);
  const update = (change: Partial<DigConditions>) => saveDigConditions({...conditions, ...change});
  const ready = mustTake.length > 0 && !!term;

  function dig() {
    startDig({term, termLabel, conditions: {...conditions, credits}, mustTake: mustTake.map(({id, code, credits: courseCredits}) => ({id, code, credits: courseCredits})), mock: params.get('mock')});
    router.push(`/dig/results?term=${encodeURIComponent(term)}`);
  }

  return (
    <Frame css={CSS} numeric>
      <header className="rise" style={s('flex-shrink: 0; padding: 12px 20px 4px; display: flex; flex-direction: column; gap: 10px')}>
        <div style={s('display: flex; align-items: center; justify-content: space-between; height: 44px')}>
          <label className="press" style={s('position: relative; height: 36px; padding: 0 10px 0 14px; border: none; border-radius: 18px; background: #ECE8E3; color: #1D1B1A; font-size: 14px; font-weight: 800; display: flex; align-items: center; gap: 4px; cursor: pointer')}>
            {termLabel || ' '}<Svg size={16} sw={2.6}>{ICON.down}</Svg>
            <select className="dg-native" aria-label={`Semester: ${termLabel}`} value={term} disabled={!terms.length} onChange={(event) => router.replace(`/dig?term=${encodeURIComponent(event.target.value)}`)}>
              {[...terms].reverse().map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <AvatarLink press />
        </div>
        <h1 style={s('margin: 0; font-size: 34px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>Let’s dig in.</h1>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 14px 20px 16px; display: flex; flex-direction: column; gap: 24px')}>
        <section className="rise" style={s('display: flex; flex-direction: column; gap: 10px; animation-delay: 60ms')}>
          <h2 style={s('margin: 0; font-size: 15px; font-weight: 800')}>Must take</h2>
          <div style={s('display: flex; flex-wrap: wrap; gap: 8px')}>
            {mustTake.map((course) => (
              <span key={course.id} style={s('height: 40px; padding: 0 4px 0 14px; border-radius: 20px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.08); display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 800')}>
                {course.code}
                <button type="button" className="press" aria-label={`Remove ${course.code}`} onClick={() => course.record && void removeCourseRecord(course.record)} style={s('width: 32px; height: 32px; border: none; background: transparent; color: #6E6863; display: flex; align-items: center; justify-content: center; border-radius: 16px; cursor: pointer; padding: 0')}>
                  <Svg size={14} sw={2.8} join={false}>{ICON.x}</Svg>
                </button>
              </span>
            ))}
            <Link href={`/schedule/add?term=${encodeURIComponent(term)}&for=dig`} className="press" style={s('height: 40px; padding: 0 14px; box-sizing: border-box; border-radius: 20px; border: 2px dashed #C9C3BC; background: transparent; color: #5F5A55; font-size: 14px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; text-decoration: none')}>
              <Svg size={14} sw={2.8} join={false}>{ICON.plus}</Svg>Add
            </Link>
          </div>
        </section>

        <section className="rise" style={s('display: flex; flex-direction: column; gap: 8px; animation-delay: 120ms')}>
          <div style={s('display: flex; align-items: baseline; justify-content: space-between')}>
            <label htmlFor="credits" style={s('font-size: 15px; font-weight: 800')}>Credits</label>
            <span aria-live="polite" style={s(`display: inline-block; font-size: 34px; font-weight: 900; letter-spacing: -0.02em; transition: transform 180ms cubic-bezier(.2,.9,.25,1.4); transform: ${bump ? 'scale(1.18)' : 'scale(1)'}`)}>{credits}</span>
          </div>
          <input id="credits" className="dg-range" type="range" min={min} max={max} step={1} value={credits} onChange={(event) => {
            update({credits: parseInt(event.target.value, 10)});
            setBump(true);
            window.clearTimeout(bumpTimer.current);
            bumpTimer.current = window.setTimeout(() => setBump(false), 140);
          }} />
          <div aria-hidden="true" style={s('display: flex; height: 10px; border-radius: 5px; overflow: hidden; gap: 3px')}>
            <span style={s(`height: 10px; border-radius: 5px; background: #1D1B1A; transition: width 260ms ease; width: ${mustPct}%`)} />
            <span style={s('flex: 1; height: 10px; border-radius: 5px; background: repeating-linear-gradient(135deg, #C9C3BC 0, #C9C3BC 4px, #E4DFD9 4px, #E4DFD9 8px)')} />
          </div>
          <div style={s('display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: #5F5A55')}>
            <span>{mustCredits} must-take</span>
            <span>{fill} dug up by DIG</span>
          </div>
        </section>

        <section className="rise" style={s('display: flex; flex-direction: column; gap: 10px; animation-delay: 180ms')}>
          <h2 style={s('margin: 0; font-size: 15px; font-weight: 800')}>Days</h2>
          <div role="group" aria-label="Days" style={s('display: flex; justify-content: space-between')}>
            {DAY_LETTERS.map((letter, day) => {
              const on = conditions.days[day];
              return (
                <button key={day} type="button" className="press" aria-pressed={on} aria-label={DAY_NAMES[day]} onClick={() => update({days: conditions.days.map((value, index) => (index === day ? !value : value))})} style={s(`width: 56px; height: 56px; border: none; border-radius: 28px; font-size: 17px; font-weight: 900; cursor: pointer; padding: 0; transition: background 220ms ease, color 220ms ease, transform 160ms ease, box-shadow 220ms ease; ${on ? 'background: #1D1B1A; color: #FFFFFF; box-shadow: 0 6px 14px rgba(29,27,26,0.22)' : 'background: #FFFFFF; color: #5F5A55; box-shadow: 0 1px 3px rgba(40,20,20,0.08)'}`)}>{letter}</button>
              );
            })}
          </div>
        </section>

        <section className="rise" style={s('display: flex; flex-direction: column; gap: 10px; animation-delay: 240ms')}>
          <h2 style={s('margin: 0; font-size: 15px; font-weight: 800')}>Hours</h2>
          <div style={s('display: flex; align-items: center; gap: 10px')}>
            <label className="press" style={s(HOUR_BUTTON)}>
              {hourLabel(conditions.earliest)}
              <select className="dg-native" aria-label={`Earliest start, ${hourLabel(conditions.earliest)}`} value={conditions.earliest} onChange={(event) => update({earliest: Number(event.target.value)})}>
                {hours(7, 12).map((minute) => <option key={minute} value={minute}>{hourLabel(minute)}</option>)}
              </select>
            </label>
            <span aria-hidden="true" style={s('width: 18px; height: 3px; border-radius: 2px; background: #C9C3BC')} />
            <label className="press" style={s(HOUR_BUTTON)}>
              {hourLabel(conditions.latest)}
              <select className="dg-native" aria-label={`Latest end, ${hourLabel(conditions.latest)}`} value={conditions.latest} onChange={(event) => update({latest: Number(event.target.value)})}>
                {hours(13, 22).map((minute) => <option key={minute} value={minute}>{hourLabel(minute)}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="rise" style={s('display: flex; flex-direction: column; gap: 10px; animation-delay: 300ms')}>
          <h2 style={s('margin: 0; font-size: 15px; font-weight: 800')}>Prefer</h2>
          <div style={s('display: flex; flex-wrap: wrap; gap: 8px')}>
            {PREFER.map(({key, label}) => {
              const on = conditions.prefer[key];
              return (
                <button key={key} type="button" className="press" aria-pressed={on} onClick={() => update({prefer: {...conditions.prefer, [key]: !on}})} style={s(`height: 44px; padding: 0 18px; border: none; border-radius: 22px; font-size: 14px; font-weight: 800; cursor: pointer; transition: background 220ms ease, color 220ms ease, transform 160ms ease; ${on ? 'background: #1D1B1A; color: #FFFFFF' : 'background: #FFFFFF; color: #5F5A55; box-shadow: 0 1px 3px rgba(40,20,20,0.08)'}`)}>{(on ? '✓  ' : '') + label}</button>
              );
            })}
          </div>
        </section>
      </main>

      <div style={s('flex-shrink: 0; padding: 8px 20px 14px')}>
        {ready ? (
          <button type="button" onClick={dig} className="digbtn" style={s('width: 100%; border: none; cursor: pointer; height: 58px; border-radius: 22px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 18px; font-weight: 900; box-shadow: 0 8px 20px rgba(140,29,43,0.30)')}>
            <Spade fill="#FFFFFF" style="height: 26px; width: 10px; transform-origin: 50% 90%" />
            Dig in
          </button>
        ) : (
          <span aria-disabled="true" style={s('height: 58px; border-radius: 22px; background: #E4DFD9; color: #6E6863; display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 18px; font-weight: 900')}>
            <Spade fill="#6E6863" style="height: 26px; width: 10px" />
            Dig in
          </span>
        )}
      </div>

      <TabBar active="dig" />
    </Frame>
  );
}

export default function DigPage() {
  return <Suspense fallback={<Frame css={CSS} numeric><span /></Frame>}><GenerateSetup /></Suspense>;
}
