'use client';

import Link from 'next/link';
import {useEffect, useState} from 'react';
import {AvatarLink, EmptyNote, Frame, ICON, Svg, TabBar} from '@/components/dg';
import {useGpa} from '@/lib/data/gpa-rows';
import {s} from '@/lib/ui/css';
import {termTick} from '@/lib/ui/format';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes fade{0%{opacity:0}100%{opacity:1}}
.rise{animation:fadeUp 440ms cubic-bezier(.2,.9,.25,1) both}
.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1200ms cubic-bezier(.4,0,.2,1) 300ms forwards}
.later{animation:fade 400ms ease 1400ms both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.97)}
.row{transition:transform 160ms ease, background 200ms ease}
.row:active{transform:scale(.98)}
`;

const fmt = (value: number | null) => (value === null ? '—' : value.toFixed(2));
const TILE = 'padding: 12px 14px; border-radius: 18px; background: #F4F1ED; display: flex; flex-direction: column';
const MAX_POINTS = 5;

/** Counts up to the value when it arrives, as the design does on load. */
function useCountUp(target: number | null): string {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (target === null) return;
    const start = Date.now();
    const timer = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / 900);
      setShown(target * (1 - Math.pow(1 - t, 3)));
      if (t >= 1) window.clearInterval(timer);
    }, 30);
    return () => window.clearInterval(timer);
  }, [target]);
  return target === null ? '—' : shown.toFixed(2);
}

/** Three gridlines that frame the data: the finest step from 0.2 up that still fits every point. */
function axis(values: number[]): {base: number; step: number} {
  if (!values.length) return {base: 3.4, step: 0.2};
  const low = Math.min(...values), high = Math.max(...values);
  for (const step of [0.2, 0.5, 1]) {
    const base = Math.max(0, Math.min(Math.floor(low / step) * step, 4 - 2 * step));
    if (high <= base + 2.4 * step) return {base, step};
  }
  return {base: 0, step: 2};
}

export default function GpaPage() {
  const {rows, terms, summary} = useGpa();
  const label = (id: string) => terms.find((term) => term.id === id)?.label ?? id;
  const points = summary.terms.slice(-MAX_POINTS);
  const [picked, setPicked] = useState<string | null>(null);
  const sel = Math.max(0, points.findIndex((point) => point.term === picked) >= 0 ? points.findIndex((point) => point.term === picked) : points.length - 1);
  const shown = useCountUp(summary.cumulative);

  const {base, step} = axis(points.flatMap((point) => [point.overall, point.major]).filter((value): value is number => value !== null));
  const x = (i: number) => 34 + i * 66;
  const y = (value: number) => 115 - ((value - base) / step) * 40;
  const line = (key: 'overall' | 'major') => {
    const drawn = points.map((point, i) => ({point, i})).filter(({point}) => point[key] !== null);
    const settled = drawn.filter(({point}) => !point.projected);
    const tail = drawn.filter(({point}) => point.projected);
    const path = (list: typeof drawn) => list.map(({point, i}, n) => `${n ? 'L' : 'M'}${x(i)} ${y(point[key]!)}`).join('');
    return {solid: settled.length > 1 ? path(settled) : '', dashed: tail.length && settled.length + tail.length > 1 ? path([...settled.slice(-1), ...tail]) : ''};
  };
  const overall = line('overall'), major = line('major');
  const selected = points[sel];

  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 12px 20px 0; display: flex; align-items: center; justify-content: space-between; height: 56px')}>
        <h1 style={s('margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -0.02em')}>GPA</h1>
        <AvatarLink />
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 10px 20px 16px; display: flex; flex-direction: column; gap: 12px')}>
        <section className="rise" style={s('flex-shrink: 0; padding: 20px; border-radius: 28px; background: #FFFFFF; box-shadow: 0 10px 28px rgba(40,20,20,0.06); display: flex; flex-direction: column; gap: 14px')}>
          <div style={s('display: flex; flex-direction: column')}>
            <span style={s('font-size: 14px; font-weight: 800; color: #5F5A55')}>Cumulative</span>
            <span style={s('font-size: 64px; font-weight: 900; letter-spacing: -0.04em; line-height: 1')}>{shown}</span>
          </div>
          <div style={s('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px')}>
            <div style={s(TILE)}><span style={s('font-size: 12px; font-weight: 800; color: #5F5A55')}>Major GPA</span><span style={s('font-size: 22px; font-weight: 900')}>{fmt(summary.major)}</span></div>
            <div style={s(TILE)}><span style={s('font-size: 12px; font-weight: 800; color: #5F5A55')}>Credits</span><span style={s('font-size: 22px; font-weight: 900')}>{summary.creditsEarned} <span style={s('font-size: 13px; font-weight: 800; color: #5F5A55')}>· {summary.majorCredits} major</span></span></div>
          </div>
        </section>

        <section className="rise" style={s('flex-shrink: 0; padding: 16px 16px 12px; border-radius: 28px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); display: flex; flex-direction: column; gap: 10px; animation-delay: 80ms')}>
          <div style={s('display: flex; align-items: center; justify-content: space-between')}>
            <h2 style={s('margin: 0; font-size: 16px; font-weight: 900')}>By semester</h2>
            <div style={s('display: flex; gap: 12px; font-size: 12px; font-weight: 800; color: #5F5A55')}>
              <span style={s('display: flex; align-items: center; gap: 5px')}><span aria-hidden="true" style={s('width: 14px; height: 4px; border-radius: 2px; background: #1D1B1A')} />Overall</span>
              <span style={s('display: flex; align-items: center; gap: 5px')}><span aria-hidden="true" style={s('width: 14px; height: 4px; border-radius: 2px; background: #3B6AA8')} />Major</span>
            </div>
          </div>
          <div aria-live="polite" style={s('min-height: 40px; padding: 8px 12px; box-sizing: border-box; border-radius: 14px; background: #F4F1ED; display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 800')}>
            <span>{selected ? `${label(selected.term)}${selected.projected ? ' · Projected' : ''}` : 'No grades yet'}</span>
            <span><span style={s('font-weight: 900')}>{fmt(selected?.overall ?? null)}</span><span style={s('color: #5F5A55')}> · </span><span style={s('font-weight: 900; color: #2F5B94')}>{fmt(selected?.major ?? null)}</span></span>
          </div>
          <svg role="img" aria-label={`GPA by semester: overall and major. ${points.map((point) => `${label(point.term)} ${fmt(point.overall)} overall, ${fmt(point.major)} major`).join('; ')}`} viewBox="0 0 310 166" style={s('width: 100%; height: auto; overflow: visible')}>
            <g fontSize="10" fontWeight="700" fill="#6E6863" fontFamily="Nunito, sans-serif">
              <text x="0" y="118">{base.toFixed(1)}</text><text x="0" y="78">{(base + step).toFixed(1)}</text><text x="0" y="38">{(base + 2 * step).toFixed(1)}</text>
            </g>
            <path d="M28 115H306M28 75H306M28 35H306" stroke="#EFEBE6" strokeWidth="1" />
            {overall.solid && <path key={`o${overall.solid}`} className="draw" pathLength={1} d={overall.solid} fill="none" stroke="#1D1B1A" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
            {major.solid && <path key={`m${major.solid}`} className="draw" pathLength={1} d={major.solid} fill="none" stroke="#3B6AA8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
            {overall.dashed && <path className="later" d={overall.dashed} fill="none" stroke="#1D1B1A" strokeWidth="3" strokeDasharray="5 6" strokeLinecap="round" />}
            {major.dashed && <path className="later" d={major.dashed} fill="none" stroke="#3B6AA8" strokeWidth="3" strokeDasharray="5 6" strokeLinecap="round" />}
            {points.map((point, i) => {
              const on = i === sel;
              return (
                <g key={point.term}>
                  {point.overall !== null && <circle cx={x(i)} cy={y(point.overall)} r={on ? 7 : 4.5} fill={on ? '#FFFFFF' : '#1D1B1A'} stroke="#1D1B1A" strokeWidth="3" />}
                  {point.major !== null && <circle cx={x(i)} cy={y(point.major)} r={on ? 7 : 4.5} fill={on ? '#FFFFFF' : '#3B6AA8'} stroke="#3B6AA8" strokeWidth="3" />}
                  <text x={x(i)} y="160" textAnchor="middle" fontSize="11" fontWeight={on ? '900' : '700'} fill={on ? '#1D1B1A' : '#6E6863'} fontFamily="Nunito, sans-serif">{termTick(label(point.term))}</text>
                  <rect x={x(i) - 28} y="20" width="56" height="146" fill="transparent" onClick={() => setPicked(point.term)} style={s('cursor: pointer')} />
                </g>
              );
            })}
          </svg>
        </section>

        <section className="rise" style={s('display: flex; flex-direction: column; gap: 6px; animation-delay: 160ms')}>
          <div style={s('display: flex; align-items: baseline; justify-content: space-between; padding: 0 4px')}><h2 style={s('margin: 0; font-size: 16px; font-weight: 900')}>Semesters</h2><Link href="/gpa/grades" style={s('font-size: 14px; font-weight: 800; color: #8C1D2B; text-decoration: none')}>Edit grades</Link></div>
          {[...summary.terms].reverse().map((term) => (
            <Link key={term.term} href={`/gpa/grades?term=${encodeURIComponent(term.term)}`} className="row" style={s('flex-shrink: 0; min-height: 60px; padding: 0 16px; border-radius: 20px; background: #FFFFFF; text-decoration: none; color: #1D1B1A; display: flex; align-items: center; gap: 10px')}>
              <span style={s('flex: 1; font-size: 16px; font-weight: 900')}>{label(term.term)}</span>
              {term.projected && <span style={s('height: 24px; padding: 0 9px; border-radius: 12px; border: 1.5px dashed #8A847E; font-size: 12px; font-weight: 900; color: #3D3936; display: flex; align-items: center')}>Projected</span>}
              <span style={s('font-size: 18px; font-weight: 900')}>{fmt(term.overall)}</span>
              <Svg size={16} sw={2.8} stroke="#8A847E">{ICON.right}</Svg>
            </Link>
          ))}
          {terms.length > 0 && rows.length === 0 && <EmptyNote>No courses yet. Add what you’re taking and what you’ve taken, then pick a grade for each.</EmptyNote>}
        </section>
      </main>

      <TabBar active="gpa" />
    </Frame>
  );
}
