'use client';

import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import {BackLink, EmptyNote, Frame} from '@/components/dg';
import {currentTermOf} from '@/lib/data/catalog';
import {setCountsTowardMajor, setGrade} from '@/lib/data/course-records';
import {useGpa} from '@/lib/data/gpa-rows';
import {GRADE_POINTS, LETTER_GRADES, type LetterGrade} from '@/lib/gpa';
import {s} from '@/lib/ui/css';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 420ms cubic-bezier(.2,.9,.25,1) both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.92)}
`;

type Edit = {grade?: LetterGrade | null; major?: boolean};
const seg = (on: boolean) => `position: relative; z-index: 1; height: 36px; border: none; background: transparent; font-size: 13px; font-weight: 900; cursor: pointer; transition: color 260ms ease; color: ${on ? '#1D1B1A' : 'rgba(255,255,255,0.8)'}`;

function EditGrades() {
  const router = useRouter();
  const params = useSearchParams();
  const {rows, terms} = useGpa();
  const currentTerm = currentTermOf(terms);
  // Edits stay on this screen until Save grades, as the design's Save button promises.
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [finality, setFinality] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState(params.get('term'));
  const [bump, setBump] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bumpTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(bumpTimer.current), []);

  const withCourses = [...terms].reverse().filter((term) => rows.some((row) => row.term === term.id));
  const term = withCourses.find((item) => item.id === picked) ?? withCourses.find((item) => item.id === currentTerm) ?? withCourses[0];
  const inTerm = rows.filter((row) => row.term === term?.id).map((row) => ({...row, grade: edits[row.id]?.grade !== undefined ? edits[row.id].grade! : row.grade, major: edits[row.id]?.major ?? row.counts_toward_major}));
  // A term is final once its grades are; until one is entered, a finished term starts as final and a current one as projected.
  const saved = rows.filter((row) => row.term === term?.id);
  const savedGraded = saved.filter((row) => row.grade !== null);
  const savedFinal = (savedGraded.length ? savedGraded : saved).every((row) => row.final);
  const final = term ? finality[term.id] ?? savedFinal : true;
  const proj = !final;

  const graded = inTerm.filter((row) => row.grade !== null);
  const points = (list: typeof graded) => {
    const credits = list.reduce((total, row) => total + row.credits, 0);
    return credits ? (list.reduce((total, row) => total + GRADE_POINTS[row.grade!] * row.credits, 0) / credits).toFixed(2) : '—';
  };

  function change(apply: () => void) {
    apply();
    setError(null);
    setBump(true);
    window.clearTimeout(bumpTimer.current);
    bumpTimer.current = window.setTimeout(() => setBump(false), 160);
  }
  const edit = (id: string, next: Edit) => change(() => setEdits((current) => ({...current, [id]: {...current[id], ...next}})));

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      for (const row of rows) {
        const pending = edits[row.id];
        const nextFinal = finality[row.term] ?? row.final;
        const grade = pending?.grade !== undefined ? pending.grade : row.grade;
        if (pending?.major !== undefined && pending.major !== row.counts_toward_major) await setCountsTowardMajor(row.id, pending.major);
        if (grade !== null && (grade !== row.grade || nextFinal !== row.final)) {
          const failure = await setGrade(row.id, grade, nextFinal);
          if (failure) throw new Error(failure);
        }
      }
      router.push('/gpa');
    } catch {
      setError('Couldn’t save your grades. Try again.');
      setSaving(false);
    }
  }

  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 8px 20px 4px 10px; display: flex; flex-direction: column; gap: 10px')}>
        <div style={s('display: flex; align-items: center; height: 44px')}>
          <BackLink href="/gpa" label="Back to GPA" />
        </div>
        <h1 style={s('margin: 0; padding-left: 10px; font-size: 32px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>Edit grades</h1>
        <div role="tablist" aria-label="Semester" style={s('padding-left: 10px; display: flex; gap: 6px; overflow-x: auto; margin-right: -20px; padding-right: 20px')}>
          {withCourses.map((item) => {
            const on = item.id === term?.id;
            return <button key={item.id} type="button" role="tab" className="press" aria-selected={on} onClick={() => setPicked(item.id)} style={s(`flex-shrink: 0; height: 36px; padding: 0 14px; border: none; border-radius: 18px; font-size: 14px; font-weight: 900; cursor: pointer; transition: background 220ms ease, color 220ms ease; ${on ? 'background: #1D1B1A; color: #FFFFFF' : 'background: #ECE8E3; color: #3D3936'}`)}>{item.label}</button>;
          })}
        </div>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 12px 20px 12px; display: flex; flex-direction: column; gap: 10px')}>
        {term && (
          <section className="rise" style={s('flex-shrink: 0; padding: 16px 18px; border-radius: 26px; background: #1D1B1A; color: #FFFFFF; display: flex; align-items: center; justify-content: space-between')}>
            <div style={s('display: flex; flex-direction: column')}>
              <span style={s('font-size: 13px; font-weight: 800; opacity: 0.75')}>{term.label} GPA</span>
              <span aria-live="polite" style={s(`display: inline-block; font-size: 44px; font-weight: 900; letter-spacing: -0.03em; line-height: 1.05; transform-origin: 0 60%; transition: transform 200ms cubic-bezier(.2,.9,.25,1.5); transform: scale(${bump ? 1.08 : 1})`)}>{points(graded)}</span>
              <span style={s('font-size: 13px; font-weight: 800; opacity: 0.75')}>Major {points(graded.filter((row) => row.major))} · {inTerm.reduce((total, row) => total + row.credits, 0)} cr</span>
            </div>
            <div role="radiogroup" aria-label="Grade status" style={s('position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 156px; padding: 4px; border-radius: 18px; background: rgba(255,255,255,0.12)')}>
              <span aria-hidden="true" style={s(`position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 14px; background: #FFFFFF; transition: transform 360ms cubic-bezier(.2,.9,.25,1.15); transform: translateX(${proj ? '0' : '100%'})`)} />
              <button type="button" role="radio" aria-checked={proj} onClick={() => change(() => setFinality((current) => ({...current, [term.id]: false})))} style={s(seg(proj))}>Projected</button>
              <button type="button" role="radio" aria-checked={!proj} onClick={() => change(() => setFinality((current) => ({...current, [term.id]: true})))} style={s(seg(!proj))}>Final</button>
            </div>
          </section>
        )}

        {inTerm.map((row, i) => {
          const code = row.course_code ?? row.course_id;
          return (
            <section key={row.id} className="rise" style={s(`flex-shrink: 0; padding: 14px; border-radius: 22px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); display: flex; flex-direction: column; gap: 12px; animation-delay: ${60 + i * 50}ms; ${proj ? 'outline: 1.5px dashed #C9C3BC; outline-offset: -1.5px' : ''}`)}>
              <div style={s('display: flex; align-items: center; justify-content: space-between; gap: 8px')}>
                <span style={s('display: flex; flex-direction: column')}><span style={s('font-size: 16px; font-weight: 900')}>{code}</span><span style={s('font-size: 13px; font-weight: 700; color: #5F5A55')}>{row.credits} credits</span></span>
                <button type="button" className="press" aria-pressed={row.major} onClick={() => edit(row.id, {major: !row.major})} style={s(`height: 32px; padding: 0 12px; border: none; border-radius: 16px; font-size: 12px; font-weight: 900; cursor: pointer; transition: background 220ms ease, color 220ms ease; ${row.major ? 'background: #DCE8F7; color: #1C3D66' : 'background: #F1EEEA; color: #5F5A55'}`)}>{row.major ? '✓ Major GPA' : 'Not in major'}</button>
              </div>
              <div role="radiogroup" aria-label={`Grade for ${code}`} style={s('display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px')}>
                {LETTER_GRADES.map((letter) => {
                  const on = row.grade === letter;
                  return <button key={letter} type="button" role="radio" className="press" aria-checked={on} onClick={() => edit(row.id, {grade: letter})} style={s(`height: 40px; border: none; border-radius: 12px; padding: 0; font-size: 14px; font-weight: 900; cursor: pointer; transition: background 200ms ease, color 200ms ease, transform 160ms ease; ${on ? 'background: #1D1B1A; color: #FFFFFF' : 'background: #F4F1ED; color: #3D3936'}`)}>{letter}</button>;
                })}
              </div>
            </section>
          );
        })}
        {terms.length > 0 && !term && <EmptyNote>No courses yet. Add what you’re taking and what you’ve taken first.</EmptyNote>}
        {error && <EmptyNote role="alert">{error}</EmptyNote>}
      </main>

      <div style={s('flex-shrink: 0; padding: 10px 20px 28px')}>
        <button type="button" onClick={() => void save()} disabled={saving} style={s('width: 100%; border: none; cursor: pointer; height: 58px; border-radius: 22px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; box-shadow: 0 8px 20px rgba(140,29,43,0.30)')}>Save grades</button>
      </div>
    </Frame>
  );
}

export default function EditGradesPage() {
  return <Suspense fallback={<Frame css={CSS} numeric><span /></Frame>}><EditGrades /></Suspense>;
}
