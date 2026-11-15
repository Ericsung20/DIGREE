'use client';

import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {Suspense, useRef, useState} from 'react';
import {BackLink, EmptyNote, Frame, ICON, SR_ONLY, Spade, Svg} from '@/components/dg';
import {currentTermOf, getBundles, previousTermOf, searchCourses, useBundleLists, useCourseDetails, useTerms, type CourseHit} from '@/lib/data/catalog';
import {addCourseRecord, changeCourseSection, removeCourseRecord, useCourseRecords} from '@/lib/data/course-records';
import {s} from '@/lib/ui/css';
import {useCourseTone} from '@/lib/ui/palette';

const CSS = `
button,input{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes popIn{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:none}}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
.pop{animation:popIn 380ms cubic-bezier(.2,.9,.25,1.4) both}
.rise{animation:fadeUp 380ms cubic-bezier(.2,.9,.25,1) both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.95)}
.field{width:100%;height:50px;box-sizing:border-box;padding:0 16px 0 44px;border:2px solid transparent;border-radius:18px;background:#FFFFFF;color:#1D1B1A;font-size:16px;font-weight:700;box-shadow:0 1px 3px rgba(40,20,20,.08);outline:none;transition:border-color 200ms ease}
.field:focus{border-color:#1D1B1A}
`;

const tabStyle = (on: boolean) => `position: relative; z-index: 1; height: 44px; border: none; background: transparent; font-size: 15px; font-weight: 900; cursor: pointer; transition: color 260ms ease; color: ${on ? '#1D1B1A' : '#6E6863'}`;
const RETURN: Record<string, string> = {profile: '/profile', chat: '/chat'};

// Step 2 of 2 for a new account, and the editor behind Course history on Profile and "Missing a class?" in Chat.
function CourseHistory() {
  const from = useSearchParams().get('from') ?? '';
  const done = RETURN[from] ?? '/';
  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const pastTerm = previousTermOf(terms);
  const records = useCourseRecords();
  const toneOf = useCourseTone();
  const [tab, setTab] = useState<'now' | 'past'>('now');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CourseHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0); // drops answers to searches the user has already typed past

  const now = records.filter((record) => record.term === currentTerm && record.status === 'enrolled_self_reported');
  const past = records.filter((record) => record.status === 'completed');
  const details = useCourseDetails([...now, ...past].map((record) => record.course_id));
  const sections = useBundleLists(currentTerm, now.map((record) => record.course_id));
  const code = (record: (typeof records)[number]) => record.course_code ?? details[record.course_id]?.code ?? record.course_id;
  const nowTab = tab === 'now';
  const taken = new Set((nowTab ? now : past).map((record) => record.course_id));
  const suggestions = hits.filter((hit) => !taken.has(hit.id)).slice(0, 6);

  async function search(value: string) {
    setQ(value);
    setError(null);
    const ticket = ++latest.current;
    try {
      const found = await searchCourses(value);
      if (ticket === latest.current) setHits(found);
    } catch {
      if (ticket === latest.current) setError('Couldn’t search courses. Check your connection and try again.');
    }
  }

  async function add(course: CourseHit) {
    if (busy) return;
    const term = nowTab ? currentTerm : pastTerm;
    if (!term) return setError(nowTab ? 'No semester is marked current yet, so there’s nothing to be taking now.' : 'There’s no earlier semester to file this under yet.');
    setBusy(true);
    try {
      // A course being taken gets its first section; the button on its row cycles through the rest.
      const first = nowTab ? (await getBundles(course.id, term))[0]?.bundle_id ?? null : null;
      const failure = await addCourseRecord({term, course_id: course.id, course_code: course.code, credits: course.credit_options[0], status: nowTab ? 'enrolled_self_reported' : 'completed', bundle_id: first, counts_toward_major: false, source: 'manual'}, currentTerm);
      setError(failure);
      if (!failure) {
        setQ('');
        setHits([]);
      }
    } catch {
      setError('Couldn’t add the course. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 8px 20px 4px 10px; display: flex; flex-direction: column; gap: 14px')}>
        <div style={s('display: flex; align-items: center; gap: 10px; height: 44px')}>
          <BackLink href={RETURN[from] ?? '/onboarding'} label="Back" />
          <div aria-label="Step 2 of 2" style={s('flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px')}>
            <span style={s('height: 6px; border-radius: 3px; background: #1D1B1A')} />
            <span style={s('height: 6px; border-radius: 3px; background: #1D1B1A')} />
          </div>
          <span style={s('font-size: 13px; font-weight: 800; color: #5F5A55; padding-right: 4px')}>2 / 2</span>
        </div>
        <h1 style={s('margin: 0; padding-left: 10px; font-size: 32px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>What are you taking?</h1>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 16px 20px 16px; display: flex; flex-direction: column; gap: 14px')}>
        <div role="tablist" aria-label="Course list" style={s('flex-shrink: 0; position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 4px; border-radius: 22px; background: #ECE8E3')}>
          <span aria-hidden="true" style={s(`position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 18px; background: #FFFFFF; box-shadow: 0 2px 8px rgba(40,20,20,0.10); transition: transform 380ms cubic-bezier(.2,.9,.25,1.15); transform: translateX(${nowTab ? '0' : '100%'})`)} />
          <button type="button" role="tab" aria-selected={nowTab} onClick={() => setTab('now')} style={s(tabStyle(nowTab))}>Taking now · {now.length}</button>
          <button type="button" role="tab" aria-selected={!nowTab} onClick={() => setTab('past')} style={s(tabStyle(!nowTab))}>Taken · {past.length}</button>
        </div>

        <label style={s('position: relative; display: block; flex-shrink: 0')}>
          <span style={s(SR_ONLY)}>Search courses</span>
          <Svg size={18} sw={2.6} stroke="#6E6863" style={s('position: absolute; left: 16px; top: 16px')}>{ICON.search}</Svg>
          <input className="field" type="text" autoComplete="off" placeholder="Search, e.g. COMP SCI 540" value={q} onChange={(event) => void search(event.target.value)} />
        </label>

        {suggestions.length > 0 && (
          <div style={s('display: flex; flex-wrap: wrap; gap: 8px')}>
            {suggestions.map((hit) => (
              <button key={hit.id} type="button" className="press" onClick={() => void add(hit)} style={s('height: 38px; padding: 0 14px; box-sizing: border-box; border-radius: 19px; border: 2px dashed #C9C3BC; background: transparent; color: #3D3936; font-size: 14px; font-weight: 800; display: inline-flex; align-items: center; gap: 6px; cursor: pointer')}>
                <Svg size={14} sw={3} join={false}>{ICON.plus}</Svg>{hit.code}
              </button>
            ))}
          </div>
        )}
        {error && <p role="alert" style={s('margin: 0; padding: 0 4px; font-size: 13px; font-weight: 700; color: #8C1D2B')}>{error}</p>}

        {nowTab && (
          <div className="rise" style={s('display: flex; flex-direction: column; gap: 8px')}>
            {now.map((record) => {
              const list = sections[record.course_id] ?? [];
              const index = list.findIndex((bundle) => bundle.bundle_id === record.bundle_id);
              const label = list[index]?.label ?? record.bundle_id;
              return (
                <div key={record.id} className="pop" style={s('min-height: 64px; padding: 10px 10px 10px 16px; box-sizing: border-box; border-radius: 20px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); display: flex; align-items: center; gap: 10px')}>
                  <span style={s(`width: 12px; height: 12px; border-radius: 6px; flex-shrink: 0; background: ${toneOf(record.course_id).dot}`)} />
                  <span style={s('flex: 1; display: flex; flex-direction: column; min-width: 0')}><span style={s('font-size: 16px; font-weight: 900')}>{code(record)}</span><span style={s('font-size: 13px; font-weight: 600; color: #5F5A55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{details[record.course_id]?.title ?? ''}</span></span>
                  {list.length > 0 && (
                    <button type="button" className="press" aria-label={`${code(record)} section ${label ?? 'not set'}, tap to change`} onClick={() => void changeCourseSection(record.id, list[(index + 1) % list.length].bundle_id).then(setError)} style={s('height: 40px; padding: 0 10px 0 12px; border: none; border-radius: 14px; background: #F1EEEA; color: #1D1B1A; font-size: 14px; font-weight: 900; display: flex; align-items: center; gap: 4px; cursor: pointer')}>
                      {label ?? 'Section'}<Svg size={14} sw={2.8}>{ICON.down}</Svg>
                    </button>
                  )}
                </div>
              );
            })}
            {terms.length > 0 && now.length === 0 && <EmptyNote>{currentTerm ? 'Nothing yet. Search for a course you’re taking.' : 'No semester is marked current yet.'}</EmptyNote>}
          </div>
        )}

        {!nowTab && (
          <div className="rise" style={s('display: flex; flex-wrap: wrap; gap: 8px')}>
            {past.map((record) => (
              <span key={record.id} className="pop" style={s('height: 42px; padding: 0 4px 0 14px; border-radius: 21px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.08); display: inline-flex; align-items: center; gap: 2px; font-size: 14px; font-weight: 800')}>
                {code(record)}
                <button type="button" className="press" aria-label={`Remove ${code(record)}`} onClick={() => void removeCourseRecord(record.id)} style={s('width: 34px; height: 34px; border: none; background: transparent; color: #6E6863; display: flex; align-items: center; justify-content: center; border-radius: 17px; cursor: pointer; padding: 0')}>
                  <Svg size={13} sw={3} join={false}>{ICON.x}</Svg>
                </button>
              </span>
            ))}
            {terms.length > 0 && past.length === 0 && <div style={s('width: 100%')}><EmptyNote>Nothing yet. Search for a course you’ve finished.</EmptyNote></div>}
          </div>
        )}
      </main>

      <div style={s('flex-shrink: 0; padding: 10px 20px 22px; display: flex; flex-direction: column; gap: 4px')}>
        <Link href={done} className="press" style={s('height: 58px; border-radius: 22px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 18px; font-weight: 900; box-shadow: 0 8px 20px rgba(140,29,43,0.30)')}>
          <Spade fill="#FFFFFF" style="height: 24px; width: 9px" />
          Start digging
        </Link>
        <Link href={done} style={s('align-self: center; min-height: 40px; display: flex; align-items: center; color: #3D3936; font-size: 14px; font-weight: 800; text-decoration: none')}>I’ll add these later</Link>
      </div>
    </Frame>
  );
}

export default function CourseHistoryPage() {
  return <Suspense fallback={<Frame css={CSS}><span /></Frame>}><CourseHistory /></Suspense>;
}
