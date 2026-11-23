'use client';

import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {Fragment, Suspense, useEffect, useRef, useState} from 'react';
import {BackLink, EmptyNote, Frame, ICON, Spade, Svg} from '@/components/dg';
import {currentTermOf, findCoursesByCodes, previousTermOf, useTerms, type CourseHit} from '@/lib/data/catalog';
import {addCourseRecord, useCourseRecords} from '@/lib/data/course-records';
import {removeDarsProgress, saveDarsProgress, useDarsProgress} from '@/lib/data/degree-progress';
import {digTerm} from '@/lib/data/dig-session';
import {useRequirements, type RequirementGroup} from '@/lib/data/requirements';
import {readDars, type DarsCourse} from '@/lib/dars';
import {s} from '@/lib/ui/css';
import {expandCourseCode, matchesCourseCode} from '@/lib/course-identity';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
@keyframes dig{0%,100%{transform:rotate(0) translateY(0)}30%{transform:rotate(-18deg) translateY(4px)}60%{transform:rotate(10deg) translateY(-2px)}}
.rise{animation:fadeUp 400ms cubic-bezier(.2,.9,.25,1) both}
.digging{animation:dig 600ms ease-in-out infinite;transform-origin:50% 90%}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.96)}
`;

const tab = (on: boolean) => `position: relative; z-index: 1; height: 42px; border: none; background: transparent; font-size: 14px; font-weight: 900; cursor: pointer; transition: color 260ms ease; color: ${on ? '#1D1B1A' : '#6E6863'}`;
const CHIP = 'height: 34px; padding: 0 12px; box-sizing: border-box; border-radius: 17px; font-size: 13px; font-weight: 900; display: inline-flex; align-items: center; ';
const READING_MS = 1400; // the progress bar fills for at least this long, as on the design
type Difference = {course: CourseHit; taken: DarsCourse};

function DarsChecklist({programId}: {programId: string}) {
  const items = useDarsProgress(programId);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(action: () => Promise<string | null>, onSaved?: () => void) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const message = await action();
      if (message) setError(message);
      else onSaved?.();
    } catch {
      setError('Couldn’t save your degree progress.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <section style={s('padding: 16px; border-radius: 22px; background: #FFFFFF')}>
      <h2 style={s('margin: 0 0 12px; font-size: 17px')}>Requirements from your report</h2>
      {items.length > 0 && <ul style={s('list-style: none; margin: 0 0 12px; padding: 0')}>
        {items.map((item) => (
          <li key={item.requirement_id} style={s('display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 0; overflow-wrap: anywhere')}>
            <span><strong>{item.requirement_id}</strong> · {item.credits_remaining} cr remaining</span>
            <button type="button" disabled={saving} onClick={() => void save(() => removeDarsProgress(programId, item.requirement_id))}>Remove</button>
          </li>
        ))}
      </ul>}
      <form style={s('display: grid; gap: 8px')} onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        void save(() => saveDarsProgress(programId, {requirement_id: String(values.get('requirement')), credits_remaining: Number(values.get('remaining'))}), () => form.reset());
      }}>
        <label style={s('display: grid; gap: 4px')}>Requirement <input name="requirement" maxLength={120} required /></label>
        <label style={s('display: grid; gap: 4px')}>Credits remaining <input name="remaining" type="number" min={0} max={200} required /></label>
        <button type="submit" disabled={saving} style={s('min-height: 44px; border: none; border-radius: 16px; background: #1D1B1A; color: #FFFFFF; font-weight: 800')}>Save requirement</button>
      </form>
      {error && <EmptyNote role="alert">{error}</EmptyNote>}
    </section>
  );
}

function Requirements() {
  const router = useRouter();
  const params = useSearchParams();
  const {program, groups, loading, error: catalogError, publishedGroupCount} = useRequirements();
  const terms = useTerms();
  const records = useCourseRecords();
  const [opened, setOpened] = useState<number | null>(null);
  const [b, setB] = useState<'idle' | 'reading' | 'review' | 'unreadable'>('idle');
  const [fileName, setFileName] = useState('');
  const [read, setRead] = useState(0);
  const [diffs, setDiffs] = useState<Difference[]>([]);
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(timer.current), []);

  const A = params.get('source') !== 'dars';
  function selectSource(dars: boolean) {
    const url = new URL(window.location.href);
    if (dars) url.searchParams.set('source', 'dars');
    else url.searchParams.delete('source');
    window.history.replaceState(null, '', url);
  }
  const open = opened;

  async function digWith(group: RequirementGroup) {
    const term = digTerm(terms, null);
    const needed = group.items.filter((item) => item.state === 'n' && item.courseCode).map((item) => item.courseCode!);
    try {
      for (const course of await findCoursesByCodes(needed)) {
        if (records.some((record) => record.term === term && record.course_id === course.id)) continue;
        await addCourseRecord({term, course_id: course.id, course_code: course.code, credits: course.credit_options[0], status: 'planned', bundle_id: null, counts_toward_major: false, source: 'manual'}, currentTermOf(terms));
      }
    } catch (failure) {
      console.error('Adding the courses to DIG failed', failure);
    }
    router.push(`/dig?term=${encodeURIComponent(term)}`);
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setB('reading');
    setRead(0);
    setResolved({});
    setError(null);
    const start = Date.now();
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => setRead(Math.min(1, (Date.now() - start) / READING_MS)), 40);
    let next: 'review' | 'unreadable' = 'unreadable';
    try {
      const reading = await readDars(file);
      if (reading.readable) {
        // Only courses the catalog knows and the history lacks are worth asking about.
        const known = await findCoursesByCodes(reading.courses.map((course) => course.code));
        const have = new Set(records.filter((record) => record.status === 'completed' || record.status === 'enrolled_self_reported').map((record) => record.course_id));
        setDiffs(known.filter((course) => !have.has(course.id)).flatMap((course) => {
          const taken = reading.courses.find((item) => matchesCourseCode(course, item.code));
          return taken ? [{course, taken}] : [];
        }));
        next = 'review';
      }
    } catch (failure) {
      console.error('Reading the DARS report failed', failure);
    }
    window.setTimeout(() => {
      window.clearInterval(timer.current);
      setB(next);
    }, Math.max(0, READING_MS - (Date.now() - start)));
  }

  async function acceptDars({course, taken}: Difference) {
    const term = terms.find((item) => item.label === `${taken.season} ${taken.year}`)?.id ?? previousTermOf(terms);
    if (!term) return setError('There’s no semester to file this course under yet.');
    const failure = await addCourseRecord({term, course_id: course.id, course_code: course.code, credits: course.credit_options[0], status: 'completed', bundle_id: null, counts_toward_major: false, source: 'manual'}, currentTermOf(terms));
    if (failure) setError(failure);
    else setResolved((current) => ({...current, [course.id]: true}));
  }

  const left = diffs.filter((difference) => !resolved[difference.course.id]).length;

  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 8px 20px 4px 10px; display: flex; flex-direction: column; gap: 10px')}>
        <div style={s('display: flex; align-items: center; height: 44px')}>
          <BackLink href="/profile" label="Back to profile" />
        </div>
        <div style={s('padding-left: 10px; display: flex; flex-direction: column; gap: 2px')}>
          <h1 style={s('margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>What’s left</h1>
          <span style={s('font-size: 14px; font-weight: 700; color: #5F5A55')}>{program ? `${program.label} · ${program.catalog_year}–${String(program.catalog_year + 1).slice(-2)} catalog` : 'Based on the courses you’ve entered'}</span>
        </div>
        <div role="tablist" aria-label="Source" style={s('margin-left: 10px; position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 4px; border-radius: 22px; background: #ECE8E3')}>
          <span aria-hidden="true" style={s(`position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 18px; background: #FFFFFF; box-shadow: 0 2px 8px rgba(40,20,20,0.10); transition: transform 380ms cubic-bezier(.2,.9,.25,1.15); transform: translateX(${A ? '0' : '100%'})`)} />
          <button type="button" role="tab" aria-selected={A} onClick={() => selectSource(false)} style={s(tab(A))}>From my courses</button>
          <button type="button" role="tab" aria-selected={!A} onClick={() => selectSource(true)} style={s(tab(!A))}>From DARS PDF</button>
        </div>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 12px 20px 24px; display: flex; flex-direction: column; gap: 8px')}>
        {A && loading && <EmptyNote role="status">Loading published requirements…</EmptyNote>}
        {A && catalogError && <EmptyNote role="alert">{catalogError}</EmptyNote>}
        {A && !loading && !catalogError && <p style={s('margin: 0 4px 6px; font-size: 13px; color: #5F5A55')}>{publishedGroupCount ? `${publishedGroupCount} requirement sections` : 'Select your program in your profile to see its published requirements.'}</p>}
        {A && groups.map((group, i) => {
          const isOpen = open === i;
          return (
            <Fragment key={group.id ?? group.name}>
            {group.programName && groups[i - 1]?.programName !== group.programName && <h2 style={s('margin: 14px 4px 4px; font-size: 17px; font-weight: 900')}>{group.programName}</h2>}
            <section className="rise" style={s(`flex-shrink: 0; border-radius: 22px; background: #FFFFFF; overflow: hidden; transition: box-shadow 260ms ease; animation-delay: ${Math.min(i * 35, 350)}ms; box-shadow: ${isOpen ? '0 10px 28px rgba(40,20,20,0.08)' : '0 1px 3px rgba(40,20,20,0.06)'}`)}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpened(isOpen ? null : i)} style={s('width: 100%; min-height: 64px; padding: 10px 14px 10px 16px; border: none; background: transparent; color: #1D1B1A; display: flex; align-items: center; gap: 12px; cursor: pointer; text-align: left')}>
                <span style={s('flex: 1; display: flex; flex-direction: column; gap: 6px')}>
                  <span style={s('display: flex; align-items: center; justify-content: space-between; gap: 8px')}><span style={s('font-size: 15px; font-weight: 900')}>{group.name}</span><span style={s(`flex-shrink: 0; font-size: 13px; font-weight: 900; color: ${group.done ? '#355A1F' : '#5F5A55'}`)}>{group.done ? 'Done' : group.count}</span></span>
                  <span aria-hidden="true" style={s('height: 6px; border-radius: 3px; background: #EFEBE6; overflow: hidden; display: block')}><span style={s(`display: block; height: 6px; border-radius: 3px; background: ${group.done ? '#3E6A24' : '#1D1B1A'}; transition: width 700ms cubic-bezier(.2,.9,.25,1) ${i * 60}ms; width: ${Math.round(group.progress * 100)}%`)} /></span>
                </span>
                <Svg size={18} sw={2.8} stroke="#6E6863" style={s(`flex-shrink: 0; transition: transform 300ms cubic-bezier(.2,.9,.25,1.2); transform: rotate(${isOpen ? 180 : 0}deg)`)}>{ICON.down}</Svg>
              </button>
              {isOpen && (
                <div className="rise" style={s('padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px')}>
                  {group.review && <p style={s('margin: 0; font-size: 13px; color: #5F5A55')}>Course matches are shown below. Credit choices, overlap, residency, and other conditions still need review against your report.</p>}
                  {group.source_url?.startsWith('https://guide.wisc.edu/') && <a href={group.source_url} target="_blank" rel="noreferrer">View published requirements</a>}
                  {group.rules?.length ? <ul aria-label="Published requirement conditions" style={s('list-style: none; margin: 0; padding: 0; display: grid; gap: 12px')}>
                    {group.rules.map(rule => <li key={rule.id} style={s('display: grid; gap: 5px; padding: 10px 0; border-bottom: 1px solid #F1EEEA; line-height: 1.5; overflow-wrap: anywhere')}>
                      {rule.label && <strong>{rule.label}</strong>}
                      {rule.courses.length > 0 && <div style={s('display: flex; flex-wrap: wrap; gap: 6px')}>
                        {rule.courses.map(code => {
                          const aliases = new Set(expandCourseCode(code));
                          const item = group.items.find(item => item.courseCode && expandCourseCode(item.courseCode).some(alias => aliases.has(alias)));
                          const state = item?.state ?? 'n';
                          return <span key={code} style={s(CHIP + (state === 'd' ? 'background: #1D1B1A; color: #FFFFFF' : state === 'p' ? 'border: 2px dashed #1D1B1A; color: #1D1B1A' : 'border: 2px solid #C9C3BC; color: #3D3936'))}>{(state === 'd' ? '✓ ' : '') + code}</span>;
                        })}
                      </div>}
                      {rule.description && <span>{rule.description}</span>}
                      {rule.credits && <span style={s('font-size: 13px; font-weight: 800')}>{rule.credits} credits</span>}
                      {rule.conditions.length > 0 && <span style={s('font-size: 13px; color: #5F5A55')}>{rule.conditions.join(' · ')}</span>}
                    </li>)}
                  </ul> : <div style={s('display: flex; flex-wrap: wrap; gap: 6px')}>
                    {group.items.map((item) => <span key={item.label} style={s(CHIP + (item.state === 'd' ? 'background: #1D1B1A; color: #FFFFFF' : item.state === 'p' ? 'border: 2px dashed #1D1B1A; color: #1D1B1A' : 'border: 2px solid #C9C3BC; color: #3D3936'))}>{(item.state === 'd' ? '✓ ' : '') + item.label}</span>)}
                  </div>}
                  {group.dig && (
                    <button type="button" onClick={() => void digWith(group)} className="press" style={s('border: none; cursor: pointer; align-self: flex-start; height: 42px; padding: 0 16px; border-radius: 21px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 900')}><Spade fill="#FFFFFF" outline={false} style="height: 18px; width: 7px" />Dig a schedule with these</button>
                  )}
                </div>
              )}
            </section>
            </Fragment>
          );
        })}
        {A && (
          <div style={s('display: flex; gap: 14px; padding: 6px 4px 0; font-size: 12px; font-weight: 800; color: #5F5A55')}>
            <span style={s('display: flex; align-items: center; gap: 6px')}><span aria-hidden="true" style={s('width: 14px; height: 14px; border-radius: 7px; background: #1D1B1A')} />Done</span>
            <span style={s('display: flex; align-items: center; gap: 6px')}><span aria-hidden="true" style={s('width: 14px; height: 14px; box-sizing: border-box; border-radius: 7px; border: 2px dashed #1D1B1A')} />Taking now</span>
            <span style={s('display: flex; align-items: center; gap: 6px')}><span aria-hidden="true" style={s('width: 14px; height: 14px; box-sizing: border-box; border-radius: 7px; border: 2px solid #C9C3BC')} />Still needed</span>
          </div>
        )}

        {!A && (b === 'idle' || b === 'unreadable') && (
          <section className="rise" style={s('padding: 28px 20px; border-radius: 26px; border: 2.5px dashed #C9C3BC; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center')}>
            <Spade fill="#8C1D2B" outline={false} style="height: 52px; width: 20px" />
            <span style={s('font-size: 18px; font-weight: 900')}>Bring in your DARS report</span>
            <span style={s('max-width: 260px; font-size: 14px; font-weight: 600; line-height: 1.5; color: #5F5A55')}>Download it from your student center as a PDF. We’ll compare it with your course history so you can confirm each difference.</span>
            {b === 'unreadable' && <span role="alert" style={s('max-width: 260px; font-size: 13px; font-weight: 700; color: #8C1D2B')}>Couldn’t read {fileName}. Choose the PDF saved from DARS.</span>}
            <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => {
              void choose(event.target.files?.[0]);
              event.target.value = '';
            }} />
            <button type="button" className="press" onClick={() => picker.current?.click()} style={s('margin-top: 4px; height: 50px; padding: 0 22px; border: none; border-radius: 20px; background: #1D1B1A; color: #FFFFFF; font-size: 16px; font-weight: 900; cursor: pointer')}>Choose PDF</button>
          </section>
        )}
        {!A && program && <DarsChecklist key={program.id} programId={program.id} />}
        {!A && b === 'reading' && (
          <section className="rise" style={s('padding: 32px 20px; border-radius: 26px; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; gap: 14px')}>
            <Spade className="digging" fill="#8C1D2B" outline={false} style="height: 52px; width: 20px" />
            <span role="status" style={s('font-size: 16px; font-weight: 900; overflow-wrap: anywhere; text-align: center')}>Reading {fileName}…</span>
            <span aria-hidden="true" style={s('width: 220px; height: 8px; border-radius: 4px; background: #EFEBE6; overflow: hidden; display: block')}><span style={s(`display: block; height: 8px; border-radius: 4px; background: #1D1B1A; width: ${Math.round(read * 100)}%`)} /></span>
          </section>
        )}
        {!A && b === 'review' && (
          <div className="rise" style={s('display: flex; flex-direction: column; gap: 8px')}>
            <div style={s('padding: 12px 16px; border-radius: 20px; background: #1D1B1A; color: #FFFFFF; display: flex; align-items: center; justify-content: space-between; gap: 10px')}><span style={s('font-size: 15px; font-weight: 900; flex-shrink: 0')}>{left ? `${left} ${left === 1 ? 'difference' : 'differences'} to review` : diffs.length ? 'All reviewed' : 'No differences found'}</span><span style={s('font-size: 13px; font-weight: 800; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{fileName}</span></div>
            {diffs.map((difference) => {
              const gone = !!resolved[difference.course.id];
              return (
                <section key={difference.course.id} aria-hidden={gone} style={s(`flex-shrink: 0; overflow: hidden; transition: max-height 420ms cubic-bezier(.2,.9,.25,1), opacity 260ms ease, transform 420ms cubic-bezier(.2,.9,.25,1); ${gone ? 'max-height: 0; opacity: 0; transform: translateX(40px)' : 'max-height: 240px; opacity: 1; transform: none'}`)}>
                  <div style={s('padding: 14px 16px; border-radius: 22px; background: #FFFFFF; display: flex; flex-direction: column; gap: 10px')}>
                    <span style={s('font-size: 12px; font-weight: 900; color: #5F5A55')}>Course history</span>
                    <span style={s('font-size: 15px; font-weight: 800; line-height: 1.4')}>DARS shows {difference.course.code} in {difference.taken.season} {difference.taken.year}. Your history doesn’t list it yet.</span>
                    <div style={s('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px')}>
                      <button type="button" className="press" tabIndex={gone ? -1 : 0} onClick={() => setResolved((current) => ({...current, [difference.course.id]: true}))} style={s('height: 44px; border: none; border-radius: 16px; background: #F1EEEA; color: #1D1B1A; font-size: 14px; font-weight: 900; cursor: pointer')}>Keep mine</button>
                      <button type="button" className="press" tabIndex={gone ? -1 : 0} onClick={() => void acceptDars(difference)} style={s('height: 44px; border: none; border-radius: 16px; background: #1D1B1A; color: #FFFFFF; font-size: 14px; font-weight: 900; cursor: pointer')}>Use DARS</button>
                    </div>
                  </div>
                </section>
              );
            })}
            {error && <EmptyNote role="alert">{error}</EmptyNote>}
            {left === 0 && <Link href="/profile" className="rise" style={s('margin-top: 6px; height: 56px; border-radius: 22px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 900; box-shadow: 0 8px 20px rgba(140,29,43,0.30)')}>Update my requirements</Link>}
          </div>
        )}
      </main>
    </Frame>
  );
}

export default function RequirementsPage() {
  return <Suspense fallback={<Frame css={CSS} numeric><p role="status">Loading requirements…</p></Frame>}><Requirements /></Suspense>;
}
