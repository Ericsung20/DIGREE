'use client';

import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useRef, useState} from 'react';
import {CloseLink, Frame, ICON, SR_ONLY, Svg} from '@/components/dg';
import {currentTermOf, searchCourses, useCourseCodes, useTerms, type CourseHit} from '@/lib/data/catalog';
import {FLAIRS, POST_TYPES, addPost} from '@/lib/data/community';
import {useCourseRecords} from '@/lib/data/course-records';
import {s} from '@/lib/ui/css';
import {shortCode} from '@/lib/ui/format';
import {useCourseTone} from '@/lib/ui/palette';

const CSS = `
button,input,textarea{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 420ms cubic-bezier(.2,.9,.25,1) both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.94)}
.title{width:100%;box-sizing:border-box;padding:0;border:none;background:transparent;color:#1D1B1A;font-size:26px;font-weight:900;letter-spacing:-0.01em;outline:none}
.title::placeholder{color:#A59D94}
.body{width:100%;min-height:150px;box-sizing:border-box;padding:16px;border:2px solid transparent;border-radius:20px;background:#FFFFFF;color:#1D1B1A;font-size:16px;font-weight:600;line-height:1.5;outline:none;resize:none;box-shadow:0 1px 3px rgba(40,20,20,.06);transition:border-color 200ms ease}
.body:focus{border-color:#1D1B1A}
.body::placeholder{color:#8A847E}
.find{width:100%;height:48px;box-sizing:border-box;padding:0 16px;border:2px solid transparent;border-radius:18px;background:#FFFFFF;color:#1D1B1A;font-size:16px;font-weight:700;box-shadow:0 1px 3px rgba(40,20,20,.08);outline:none;transition:border-color 200ms ease}
.find:focus{border-color:#1D1B1A}
.find::placeholder{color:#8A847E}
`;

const HINTS = ['What do you want to ask?', 'What was the class like?', 'What should others know?'];
const DASHED = 'height: 40px; padding: 0 14px; box-sizing: border-box; border-radius: 20px; border: 2px dashed #C9C3BC; background: transparent; color: #5F5A55; font-size: 14px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; cursor: pointer';

function Composer() {
  const router = useRouter();
  const initial = useSearchParams().get('course');
  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const mine = useCourseRecords().filter((record) => record.term === currentTerm && record.status === 'enrolled_self_reported').map((record) => record.course_id);
  const toneOf = useCourseTone();
  const [type, setType] = useState(0);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [course, setCourse] = useState<string | null>(initial);
  // A course found through "Other" joins the chips so the choice stays visible.
  const [extra, setExtra] = useState<CourseHit | null>(null);
  const [finding, setFinding] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CourseHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latest = useRef(0);

  const tags = [...new Set([...mine, ...(initial ? [initial] : []), ...(extra ? [extra.id] : [])])];
  const codes = useCourseCodes(tags);
  const back = initial ? `/community?course=${encodeURIComponent(initial)}` : '/community';
  const ready = title.trim().length > 0;

  async function search(value: string) {
    setQ(value);
    setHits([]);
    const ticket = ++latest.current;
    if (value.trim().length < 2) return;
    try {
      const matches = await searchCourses(value);
      if (latest.current === ticket) setHits(matches);
    } catch {
      if (latest.current === ticket) setError('Couldn’t search courses. Try again.');
    }
  }

  async function post() {
    if (saving || !ready) return;
    setSaving(true);
    setError(null);
    try {
      // The details are optional on this screen, and a post needs a body: the title stands in.
      const result = await addPost({title, body: details.trim() || title, category: POST_TYPES[type], course_id: course});
      if ('error' in result) {
        setError(result.error);
        setSaving(false);
      } else router.replace(back);
    } catch {
      setError('Couldn’t post. Try again.');
      setSaving(false);
    }
  }

  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 8px 20px 0 10px; display: flex; align-items: center; justify-content: space-between; height: 52px')}>
        <CloseLink href={back} label="Discard and close" />
        <span style={s('font-size: 16px; font-weight: 900')}>New post</span>
        {ready
          ? <button type="button" onClick={() => void post()} disabled={saving} className="press" style={s('border: none; cursor: pointer; height: 40px; padding: 0 18px; border-radius: 20px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; font-size: 15px; font-weight: 900; box-shadow: 0 6px 14px rgba(140,29,43,0.28)')}>Post</button>
          : <span aria-disabled="true" style={s('height: 40px; padding: 0 18px; border-radius: 20px; background: #E4DFD9; color: #6E6863; display: flex; align-items: center; font-size: 15px; font-weight: 900')}>Post</span>}
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 12px 20px 24px; display: flex; flex-direction: column; gap: 18px')}>
        <div role="radiogroup" aria-label="Post type" className="rise" style={s('flex-shrink: 0; position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 4px; border-radius: 22px; background: #ECE8E3')}>
          <span aria-hidden="true" style={s(`position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / 3); border-radius: 18px; background: #FFFFFF; box-shadow: 0 2px 8px rgba(40,20,20,0.10); transition: transform 380ms cubic-bezier(.2,.9,.25,1.15); transform: translateX(${type * 100}%)`)} />
          {POST_TYPES.map((flair, i) => {
            const on = i === type;
            return <button key={flair} type="button" role="radio" aria-checked={on} onClick={() => setType(i)} style={s(`position: relative; z-index: 1; height: 44px; border: none; background: transparent; font-size: 15px; font-weight: 900; cursor: pointer; transition: color 260ms ease; color: ${on ? '#1D1B1A' : '#6E6863'}`)}>{FLAIRS[flair]}</button>;
          })}
        </div>

        <div className="rise" style={s('display: flex; flex-direction: column; gap: 4px; animation-delay: 60ms')}>
          <label><span style={s(SR_ONLY)}>Title</span><input className="title" type="text" maxLength={120} placeholder={HINTS[type]} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <span style={s('align-self: flex-end; font-size: 12px; font-weight: 800; color: #6E6863')}>{title.length} / 120</span>
        </div>

        <label className="rise" style={s('display: block; animation-delay: 120ms')}><span style={s(SR_ONLY)}>Details</span><textarea className="body" placeholder="Add details. No names of other students, please." value={details} onChange={(event) => setDetails(event.target.value)} /></label>

        <section className="rise" style={s('display: flex; flex-direction: column; gap: 10px; animation-delay: 180ms')}>
          <h2 style={s('margin: 0; font-size: 15px; font-weight: 800')}>Tag a course</h2>
          <div style={s('display: flex; flex-wrap: wrap; gap: 8px')}>
            {tags.map((id) => {
              const on = course === id;
              const tone = toneOf(id);
              return <button key={id} type="button" className="press" aria-pressed={on} onClick={() => setCourse(on ? null : id)} style={s(`height: 40px; padding: 0 14px; border: none; border-radius: 20px; font-size: 14px; font-weight: 900; cursor: pointer; transition: background 220ms ease, color 220ms ease, box-shadow 220ms ease; ${on ? `background: ${tone.bg}; color: ${tone.fg}; box-shadow: inset 0 0 0 2px ${tone.fg}` : 'background: #FFFFFF; color: #3D3936; box-shadow: 0 1px 3px rgba(40,20,20,0.08)'}`)}>{(on ? '✓ ' : '') + shortCode(codes[id] ?? (extra?.id === id ? extra.code : id))}</button>;
            })}
            <button type="button" className="press" aria-expanded={finding} onClick={() => setFinding(!finding)} style={s(DASHED)}><Svg size={14} sw={2.8} join={false}>{ICON.plus}</Svg>Other</button>
          </div>
          {finding && (
            <>
              <label><span style={s(SR_ONLY)}>Find a course to tag</span><input className="find" type="text" autoComplete="off" autoFocus placeholder="Search, e.g. COMP SCI 540" value={q} onChange={(event) => void search(event.target.value)} /></label>
              <div style={s('display: flex; flex-wrap: wrap; gap: 8px')}>
                {hits.slice(0, 6).map((hit) => (
                  <button key={hit.id} type="button" className="press" onClick={() => {
                    setExtra(hit);
                    setCourse(hit.id);
                    setFinding(false);
                    setQ('');
                    setHits([]);
                  }} style={s(DASHED)}><Svg size={14} sw={2.8} join={false}>{ICON.plus}</Svg>{hit.code}</button>
                ))}
              </div>
            </>
          )}
          {error && <span role="alert" style={s('font-size: 13px; font-weight: 700; color: #8C1D2B')}>{error}</span>}
        </section>
      </main>
    </Frame>
  );
}

export default function NewPostPage() {
  return <Suspense fallback={<Frame css={CSS}><span /></Frame>}><Composer /></Suspense>;
}
