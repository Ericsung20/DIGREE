'use client';

import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useEffect, useRef, useState} from 'react';
import {CloseLink, EmptyNote, Frame, ICON, SR_ONLY, Svg} from '@/components/dg';
import {bundleKey, currentTermOf, getBundles, searchCourses, useBuildingNames, useBundlesFor, useCourseInfo, useTerms, type Bundle, type CourseHit, type Meeting} from '@/lib/data/catalog';
import {addCourseRecord, changeCourseSection, removeCourseRecord, useCourseRecords, type CourseRecordStatus} from '@/lib/data/course-records';
import {s} from '@/lib/ui/css';
import {DAY_LETTERS, WEEKDAYS, meetingSummary, shortCode} from '@/lib/ui/format';

const CSS = `
button,input{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 420ms cubic-bezier(.2,.9,.25,1) both}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.97)}
.field{width:100%;height:50px;box-sizing:border-box;padding:0 16px 0 44px;border:2px solid #1D1B1A;border-radius:18px;background:#FFFFFF;color:#1D1B1A;font-size:16px;font-weight:800;outline:none}
`;

// The mini week shows 8 AM to 5 PM in 150px.
const H = 150 / 9;
const top = (min: number) => Math.max(0, Math.min(150, (min / 60 - 8) * H));
const box = (meeting: Pick<Meeting, 'start_min' | 'end_min'>) => `top: ${top(meeting.start_min)}px; height: ${Math.max(4, top(meeting.end_min) - top(meeting.start_min) - 2)}px`;
const overlaps = (a: Meeting, b: Meeting) => a.day === b.day && a.start_min < b.end_min && b.start_min < a.end_min;
const CTA = 'height: 58px; border: none; border-radius: 22px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; box-shadow: 0 8px 20px rgba(140,29,43,0.30); cursor: pointer; width: 100%';

function AddCourse() {
  const params = useSearchParams();
  const router = useRouter();
  const terms = useTerms();
  const currentTerm = currentTermOf(terms);
  const term = terms.find((item) => item.id === params.get('term'))?.id ?? currentTerm ?? terms.at(-1)?.id ?? '';
  const termLabel = terms.find((item) => item.id === term)?.label ?? '';
  const forDig = params.get('for') === 'dig';
  const editId = params.get('course');
  const records = useCourseRecords();
  const editing = editId ? records.find((record) => record.term === term && record.course_id === editId && record.status !== 'planned' && record.status !== 'withdrawn') : undefined;
  const editCourse = useCourseInfo(editing ? editId : null);

  const [q, setQ] = useState<string | null>(null);
  const [hits, setHits] = useState<CourseHit[]>([]);
  const [chosen, setChosen] = useState<CourseHit | null>(null);
  const [loaded, setLoaded] = useState<{key: string; bundles: Bundle[]} | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latest = useRef(0); // drops answers to searches the user has already typed past

  // A course added to a term that has not started is a must-take for DIG, not an enrollment.
  const order = terms.findIndex((item) => item.id === term) - terms.findIndex((item) => item.id === currentTerm);
  const status: CourseRecordStatus = forDig || currentTerm === null || order > 0 ? 'planned' : order < 0 ? 'completed' : 'enrolled_self_reported';
  const planning = status === 'planned' && !editing;
  // A past semester takes several courses in one go, the way onboarding's Taken tab does.
  const batch = status === 'completed' && !editing;
  const filed = batch ? records.filter((record) => record.term === term && record.status === 'completed') : [];
  const filedIds = new Set(filed.map((record) => record.course_id));
  const course = chosen ?? (q === null ? editCourse : null);
  const text = q ?? (editCourse ? editCourse.code : '');
  const key = course ? `${term}|${course.id}` : '';
  const bundles = loaded?.key === key ? loaded.bundles : null;
  const schedule = `/?term=${encodeURIComponent(term)}`;
  const dig = `/dig?term=${encodeURIComponent(term)}`;
  const back = forDig ? dig : schedule;

  useEffect(() => {
    if (!course || !term || planning) return;
    let active = true;
    getBundles(course.id, term)
      .then((list) => {
        if (active) setLoaded({key: `${term}|${course.id}`, bundles: list});
      })
      .catch(() => {
        if (active) setLoaded({key: `${term}|${course.id}`, bundles: []});
      });
    return () => {
      active = false;
    };
  }, [course, term, planning]);

  async function search(value: string) {
    setQ(value);
    setError(null);
    setChosen(null);
    const ticket = ++latest.current;
    try {
      const found = await searchCourses(value);
      if (ticket !== latest.current) return;
      setHits(found);
      if (batch) return;
      const exact = found.find((hit) => [hit.code, shortCode(hit.code)].some((code) => code.toLowerCase() === value.trim().toLowerCase()));
      if (exact) setChosen(exact);
    } catch {
      if (ticket === latest.current) setError('Couldn’t search courses. Check your connection and try again.');
    }
  }

  // What is already on the week for this term, apart from the course being changed.
  const others = records.filter((record) => record.term === term && (record.status === 'enrolled_self_reported' || record.status === 'completed') && record.course_id !== course?.id);
  const sections = useBundlesFor(others);
  const existing = others.flatMap((record) => (sections[bundleKey(record)]?.meetings ?? []).map((meeting) => ({...meeting, code: record.course_code ?? record.course_id})));
  const clash = (bundle: Bundle) => existing.find((meeting) => bundle.meetings.some((own) => overlaps(own, meeting)));
  const historical = (editing?.status ?? status) === 'completed';
  const cur = bundles?.find((bundle) => bundle.bundle_id === (pick ?? editing?.bundle_id)) ?? (historical ? null : bundles?.[0] ?? null);
  const conflict = cur ? clash(cur) : undefined;
  const buildings = useBuildingNames((bundles ?? []).flatMap((bundle) => bundle.meetings.flatMap((meeting) => (meeting.building_id ? [meeting.building_id] : []))));
  const room = (bundle: Bundle) => [...new Set(bundle.meetings.map((meeting) => (meeting.building_id ? buildings[meeting.building_id] ?? meeting.building_id : meeting.mode === 'online_sync' ? 'Online' : '')).filter(Boolean))].join(', ') || 'Location not listed';

  async function save() {
    if (!course || saving) return;
    setSaving(true);
    setError(null);
    try {
      const failure = editing
        ? await changeCourseSection(editing.id, pick === '' ? null : cur?.bundle_id ?? editing.bundle_id)
        : await addCourseRecord({term, course_id: course.id, course_code: course.code, credits: course.credit_options[0], status, bundle_id: planning ? null : cur?.bundle_id ?? null, counts_toward_major: false, source: 'manual'}, currentTerm);
      if (failure) setError(failure);
      else router.push(planning ? dig : back);
    } catch {
      setError('Couldn’t save the course. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function file(hit: CourseHit) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const failure = await addCourseRecord({term, course_id: hit.id, course_code: hit.code, credits: hit.credit_options[0], status: 'completed', bundle_id: null, counts_toward_major: false, source: 'manual'}, currentTerm);
      setError(failure);
      if (!failure) {
        setQ('');
        setHits([]);
      }
    } catch {
      setError('Couldn’t add the course. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing || saving) return;
    setSaving(true);
    await removeCourseRecord(editing.id);
    router.push(back);
  }

  const suggestions = batch ? hits.filter((hit) => !filedIds.has(hit.id)).slice(0, 8) : course ? [] : hits.slice(0, 8);
  const cta = editing ? 'Change section' : planning ? `Add to ${termLabel} must-takes` : conflict ? 'Add anyway' : `Add to ${termLabel}`;
  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 8px 20px 4px 10px; display: flex; flex-direction: column; gap: 6px')}>
        <div style={s('display: flex; align-items: center; justify-content: space-between; height: 44px')}>
          <CloseLink href={back} label="Close" />
          <span style={s('font-size: 14px; font-weight: 800; color: #5F5A55')}>{termLabel}</span>
        </div>
        <h1 style={s('margin: 0; padding-left: 10px; font-size: 32px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>{editing ? 'Change section' : batch ? 'Add courses' : 'Add a course'}</h1>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 14px 20px 12px; display: flex; flex-direction: column; gap: 14px')}>
        <label className="rise" style={s('position: relative; display: block')}>
          <span style={s(SR_ONLY)}>Search courses</span>
          <Svg size={18} sw={2.6} stroke="#1D1B1A" style={s('position: absolute; left: 16px; top: 16px')}>{ICON.search}</Svg>
          <input className="field" type="text" autoComplete="off" autoFocus={!editId} placeholder="Search, e.g. COMP SCI 540" value={text} onChange={(event) => void search(event.target.value)} readOnly={!!editing} />
        </label>

        {suggestions.length > 0 && (
          <div className="rise" style={s('display: flex; flex-wrap: wrap; gap: 8px')}>
            {suggestions.map((hit) => (
              <button key={hit.id} type="button" className="press" disabled={batch && saving} onClick={() => {
                if (batch) return void file(hit);
                setQ(hit.code);
                setChosen(hit);
              }} style={s('height: 38px; padding: 0 14px; box-sizing: border-box; border-radius: 19px; border: 2px dashed #C9C3BC; background: transparent; color: #3D3936; font-size: 14px; font-weight: 800; display: inline-flex; align-items: center; gap: 6px; cursor: pointer')}>
                <Svg size={14} sw={3} join={false}>{ICON.plus}</Svg>{hit.code}
              </button>
            ))}
          </div>
        )}
        {!course && text.trim().length >= 2 && hits.length === 0 && !error && <EmptyNote>No course matches “{text.trim()}”.</EmptyNote>}

        {batch && (
          <div className="rise" style={s('display: flex; flex-direction: column; gap: 8px; animation-delay: 60ms')}>
            <span style={s('padding: 0 4px; font-size: 14px; font-weight: 800')}>Taken in {termLabel} · {filed.length}</span>
            <div style={s('display: flex; flex-wrap: wrap; gap: 8px')}>
              {filed.map((record) => {
                const label = record.course_code ?? record.course_id;
                return (
                  <span key={record.id} style={s('height: 42px; padding: 0 4px 0 14px; border-radius: 21px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.08); display: inline-flex; align-items: center; gap: 2px; font-size: 14px; font-weight: 800')}>
                    {label}
                    <button type="button" className="press" aria-label={`Remove ${label}`} onClick={() => void removeCourseRecord(record.id)} style={s('width: 34px; height: 34px; border: none; background: transparent; color: #6E6863; display: flex; align-items: center; justify-content: center; border-radius: 17px; cursor: pointer; padding: 0')}>
                      <Svg size={13} sw={3} join={false}>{ICON.x}</Svg>
                    </button>
                  </span>
                );
              })}
            </div>
            {filed.length === 0 && <EmptyNote>Search, then tap each course you took. Set a section later from the course.</EmptyNote>}
          </div>
        )}

        {course && !batch && (
          <div className="rise" style={s('display: flex; align-items: center; justify-content: space-between; padding: 0 4px; animation-delay: 60ms')}>
            <div style={s('display: flex; flex-direction: column')}><span style={s('font-size: 18px; font-weight: 900')}>{course.code}</span><span style={s('font-size: 14px; font-weight: 600; color: #5F5A55')}>{course.title ?? ''}</span></div>
            <span style={s('flex-shrink: 0; height: 30px; padding: 0 12px; border-radius: 15px; background: #ECE8E3; font-size: 14px; font-weight: 900; display: flex; align-items: center')}>{course.credit_options[0]} cr</span>
          </div>
        )}

        {course && !planning && !batch && bundles && bundles.length > 0 && (
          <div role="radiogroup" aria-label="Sections" className="rise" style={s('display: flex; flex-direction: column; gap: 8px; animation-delay: 120ms')}>
            {historical && <button type="button" role="radio" aria-checked={!cur} onClick={() => setPick('')} className="press" style={s(`min-height: 44px; padding: 0 14px; border-radius: 20px; text-align: left; background: #FFFFFF; color: #1D1B1A; font-weight: 800; cursor: pointer; border: ${cur ? '1px solid #C9C3BC' : '2px solid #1D1B1A'}`)}>Unknown section</button>}
            {bundles.map((bundle) => {
              const on = bundle === cur;
              return (
                <button key={bundle.bundle_id} type="button" role="radio" aria-checked={on} onClick={() => setPick(bundle.bundle_id)} className="press" style={s(`min-height: 66px; padding: 10px 14px; border: none; border-radius: 20px; display: flex; align-items: center; gap: 12px; cursor: pointer; color: #1D1B1A; transition: box-shadow 220ms ease, background 220ms ease; ${on ? 'background: #FFFFFF; box-shadow: 0 0 0 2.5px #1D1B1A, 0 8px 20px rgba(40,20,20,0.08)' : 'background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06)'}`)}>
                  <span style={s(`width: 22px; height: 22px; box-sizing: border-box; border-radius: 11px; flex-shrink: 0; transition: border-width 200ms ease; border: ${on ? '7px solid #1D1B1A' : '2px solid #A59D94'}`)} />
                  <span style={s('flex: 1; display: flex; flex-direction: column; text-align: left')}><span style={s('font-size: 15px; font-weight: 900')}>{bundle.label}{bundle.meetings.length ? ` · ${meetingSummary(bundle.meetings, ' ')}` : ''}</span><span style={s('font-size: 13px; font-weight: 600; color: #5F5A55')}>{bundle.meetings.length ? room(bundle) : 'No set meeting time'}</span></span>
                  {clash(bundle) && <span style={s('height: 26px; padding: 0 10px; border-radius: 13px; background: #FCEFD2; color: #6B4500; font-size: 12px; font-weight: 900; display: flex; align-items: center')}>Conflict</span>}
                </button>
              );
            })}
          </div>
        )}
        {course && !planning && !batch && bundles && bundles.length === 0 && <EmptyNote>No section times for {termLabel} yet. You can still add the course.</EmptyNote>}

        {course && !planning && !batch && cur && (
          <section aria-label="Where it lands" className="rise" style={s('padding: 14px; border-radius: 22px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06); display: flex; flex-direction: column; gap: 8px; animation-delay: 180ms')}>
            <div style={s('display: flex; align-items: center; justify-content: space-between')}>
              <span style={s('font-size: 14px; font-weight: 800')}>Where it lands</span>
              <span style={s(`height: 26px; padding: 0 10px; border-radius: 13px; font-size: 12px; font-weight: 900; display: flex; align-items: center; ${conflict ? 'background: #FCEFD2; color: #6B4500' : 'background: #ECE8E3; color: #1D1B1A'}`)}>{conflict ? `Overlaps ${shortCode(conflict.code)}` : 'Fits your week'}</span>
            </div>
            <div aria-hidden="true" style={s('display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; height: 150px')}>
              {WEEKDAYS.map((day) => (
                <div key={day} style={s('position: relative; border-radius: 10px; background: #F4F1ED')}>
                  {existing.filter((meeting) => meeting.day === day).map((meeting, i) => <span key={i} style={s(`position: absolute; left: 3px; right: 3px; ${box(meeting)}; border-radius: 6px; background: #DDD8D2`)} />)}
                  {cur.meetings.filter((meeting) => meeting.day === day).map((meeting, i) => (
                    <span key={i} style={s(`position: absolute; left: 3px; right: 3px; ${box(meeting)}; box-sizing: border-box; border-radius: 6px; transition: top 460ms cubic-bezier(.2,.9,.25,1.2), opacity 260ms ease, transform 360ms cubic-bezier(.2,.9,.25,1.4); ${conflict ? 'background: #FCEFD2; border: 2px dashed #B7791F' : 'background: #CFE0F5; border: 2px solid #1C3D66'}; opacity: 1; transform: scale(1)`)} />
                  ))}
                </div>
              ))}
            </div>
            <div aria-hidden="true" style={s('display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; font-size: 12px; font-weight: 800; color: #6E6863; text-align: center')}>{DAY_LETTERS.map((letter, i) => <span key={i}>{letter}</span>)}</div>
          </section>
        )}
        {course && planning && <EmptyNote>DIG picks the section that fits your conditions best.</EmptyNote>}
        {error && <EmptyNote role="alert">{error}</EmptyNote>}
      </main>

      <div style={s(editing ? 'flex-shrink: 0; padding: 10px 20px 22px; display: flex; flex-direction: column; gap: 4px' : 'flex-shrink: 0; padding: 10px 20px 28px')}>
        {batch
          ? <button type="button" className="press" onClick={() => router.push(back)} style={s(CTA)}>Done</button>
          : course
          ? <button type="button" className="press" onClick={() => void save()} disabled={saving} style={s(CTA)}>{cta}</button>
          : <span aria-disabled="true" style={s('height: 58px; border-radius: 22px; background: #E4DFD9; color: #6E6863; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900')}>{`Add to ${termLabel}`}</span>}
        {editing && <button type="button" onClick={() => void remove()} disabled={saving} style={s('align-self: center; min-height: 40px; border: none; background: transparent; display: flex; align-items: center; color: #3D3936; font-size: 14px; font-weight: 800; cursor: pointer')}>Remove from {termLabel}</button>}
      </div>
    </Frame>
  );
}

export default function AddCoursePage() {
  return <Suspense fallback={<Frame css={CSS} numeric><span /></Frame>}><AddCourse /></Suspense>;
}
