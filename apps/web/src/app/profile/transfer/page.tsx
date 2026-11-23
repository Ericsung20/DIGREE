'use client';

import {useRef, useState} from 'react';
import {BackLink, EmptyNote, Frame, ICON, Svg} from '@/components/dg';
import {displayCourseCode} from '@/lib/course-identity';
import {currentTermOf, searchCourses, useCourseDetails, useTerms, type CourseHit} from '@/lib/data/catalog';
import {removeTransferCredit, saveTransferCredit, useTransferCredits} from '@/lib/data/transfer-credits';
import {s} from '@/lib/ui/css';
import {TONES, hashIndex} from '@/lib/ui/palette';

const FIELD = 'display: grid; gap: 6px; font-size: 14px; font-weight: 800';
const INPUT = 'min-height: 48px; width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #EAE6E1; background: #F7F5F2; color: #1D1B1A; border-radius: 16px; font: inherit';
const BUTTON = 'min-height: 48px; border: none; border-radius: 16px; padding: 12px 14px; background: #F1EEEA; color: #1D1B1A; font: inherit; font-weight: 900; cursor: pointer';

export default function TransferPage() {
  const transfers = useTransferCredits();
  const terms = useTerms();
  const current = currentTermOf(terms);
  const recognizedTerms = current ? terms.filter(term => terms.indexOf(term) <= terms.findIndex(item => item.id === current)) : terms;
  const details = useCourseDetails(transfers.flatMap(row => row.equivalent_course_id ? [row.equivalent_course_id] : []));
  const [editing, setEditing] = useState<string | undefined>();
  const [generalEditing, setGeneralEditing] = useState(false);
  const [institution, setInstitution] = useState('');
  const [sourceCourse, setSourceCourse] = useState('');
  const [credits, setCredits] = useState('3');
  const [term, setTerm] = useState('');
  const [notes, setNotes] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CourseHit[]>([]);
  const [equivalent, setEquivalent] = useState<{id: string; code: string; display_code?: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const searchTicket = useRef(0);

  function clear() {
    setEditing(undefined); setGeneralEditing(false); setSourceCourse(''); setCredits('3');
    setNotes(''); setEquivalent(null); setQuery(''); setHits([]); ++searchTicket.current;
  }

  return <Frame css="input,select,textarea,button{font:inherit}" numeric>
    <header style={s('display: flex; align-items: center; gap: 8px; padding: 12px')}>
      <BackLink href="/profile" label="Back to profile" /><h1 style={s('font-size: 24px; font-weight: 900; margin: 0')}>Transfer credit</h1>
    </header>
    <main style={s('flex: 1; overflow: auto; padding: 8px 20px 24px; display: flex; flex-direction: column; gap: 16px')}>
      <p style={s('margin: 0; color: #5F5A55; line-height: 1.5')}>Add the UW courses and credits you’ve been awarded. They count toward course requirements and prerequisites, without affecting your UW GPA.</p>
      {transfers.map(row => {const course = row.equivalent_course_id ? details[row.equivalent_course_id] : null; const tone = TONES[hashIndex(row.equivalent_course_id ?? row.id, TONES.length)]; return <section key={row.id} style={s('padding: 18px; border-radius: 24px; background: #FFFFFF; display: grid; gap: 14px')}>
        <div style={s('display: grid; gap: 6px')}>
          <span style={s(`justify-self: start; padding: 3px 10px; border-radius: 16px; font-size: 13px; font-weight: 900; background: ${tone.bg}; color: ${tone.fg}`)}>{course ? displayCourseCode(course) : row.source_course ?? 'UW transfer credit'}</span>
          <h2 style={s('margin: 0; font-size: 22px; font-weight: 900; line-height: 1.2')}>{course?.title ?? 'Recognized transfer credit'}</h2>
        </div>
        <div style={s('padding: 12px 14px; border-radius: 16px; background: #F7F5F2; display: grid; gap: 2px')}><span style={s('font-size: 12px; font-weight: 700; color: #5F5A55')}>Recognized credits</span><strong style={s('font-size: 18px; font-weight: 900')}>{row.credits}</strong></div>
        {row.institution && <span style={s('display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600')}><Svg size={18} sw={2.2} stroke="#6E6863">{ICON.pin}</Svg>{row.institution}{row.source_course ? ` · ${row.source_course}` : ''}</span>}
        {row.notes && <span>{row.notes}</span>}
        <div style={s('display: grid; grid-template-columns: 1fr 1fr; gap: 8px')}>
          <button disabled={busy} style={s(BUTTON)} onClick={() => {
            setEditing(row.id); setInstitution(row.institution ?? ''); setSourceCourse(row.source_course ?? ''); setCredits(String(row.credits));
            setGeneralEditing(!row.equivalent_course_id);
            setTerm(row.awarded_term); setNotes(row.notes); setError(''); setMessage(''); setHits([]); setQuery(''); ++searchTicket.current;
            setEquivalent(row.equivalent_course_id ? details[row.equivalent_course_id] ?? {id: row.equivalent_course_id, code: row.equivalent_course_id} : null);
          }}>Edit</button>
          <button disabled={busy} style={s(BUTTON)} onClick={async () => {
            setBusy(true); setError('');
            try { await removeTransferCredit(row.id); if (editing === row.id) clear(); setMessage('Transfer credit removed.'); }
            catch { setError('Couldn’t remove this transfer credit.'); } finally { setBusy(false); }
          }}>Remove</button>
        </div>
      </section>;})}
      <form style={s('display: grid; gap: 14px; background: #FFFFFF; padding: 16px; border-radius: 20px')} onSubmit={async event => {
        event.preventDefault(); if (busy) return;
        if (!equivalent && !generalEditing) { setError('Choose the UW course recognized for this credit.'); return; }
        setBusy(true); setError(''); setMessage('');
        try {
          await saveTransferCredit({institution, source_course: sourceCourse, credits: Number(credits), awarded_term: term || current || '', equivalent_course_id: equivalent?.id ?? null, notes}, editing);
          clear(); setMessage('Transfer credit saved.');
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t save transfer credit.'); }
        finally { setBusy(false); }
      }}>
        <h2 style={s('font-size: 22px; font-weight: 900; margin: 0')}>{editing ? 'Edit recognized credit' : 'Add recognized credit'}</h2>
        <label style={s(FIELD)}>Recognized UW course{!equivalent && <input value={query} placeholder="Search a course, e.g. MATH 221" style={s(INPUT)} onChange={async event => {
          const value = event.target.value; setQuery(value); const ticket = ++searchTicket.current;
          try { const result = await searchCourses(value); if (ticket === searchTicket.current) setHits(result); }
          catch { if (ticket === searchTicket.current) setError('Couldn’t search UW courses.'); }
        }} />}</label>
        {hits.slice(0, 6).map(hit => <button key={hit.id} type="button" style={s(BUTTON)} onClick={() => { setEquivalent(hit); setCredits(String(hit.credit_options[0] ?? 3)); setHits([]); setQuery(''); ++searchTicket.current; }}>{displayCourseCode(hit)} · {hit.title}</button>)}
        {equivalent && <div style={s('display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; background: #F1EEEA; border-radius: 12px')}><strong>{displayCourseCode(equivalent)}</strong> <button type="button" style={s(BUTTON)} onClick={() => setEquivalent(null)}>Change</button></div>}
        {!equivalent && editing && sourceCourse && <p style={s('margin: 0; font-size: 13px')}>General transfer credit: {sourceCourse}</p>}
        <label style={s(FIELD)}>Recognized credits<input required type="number" min="0.01" max="30" step="0.01" value={credits} onChange={event => setCredits(event.target.value)} style={s(INPUT)} /></label>
        <details>
          <summary style={s('cursor: pointer; font-size: 14px; font-weight: 800')}>Optional details</summary>
          <div style={s('display: grid; gap: 12px; padding-top: 12px')}>
            <label style={s(FIELD)}>Source school (optional)<input maxLength={160} value={institution} onChange={event => setInstitution(event.target.value)} style={s(INPUT)} /></label>
            <label style={s(FIELD)}>Recognized by semester<select value={term || current || ''} onChange={event => setTerm(event.target.value)} style={s(INPUT)}>
              <option value="">Choose a semester</option>{recognizedTerms.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select></label>
            <label style={s(FIELD)}>Notes (optional)<textarea maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} style={s(INPUT)} /></label>
          </div>
        </details>
        <button disabled={busy || (!equivalent && !generalEditing)} style={s(BUTTON + '; background: #8C1D2B; color: #FFFFFF')}>{busy ? 'Saving…' : 'Save transfer credit'}</button>
        {editing && <button type="button" disabled={busy} onClick={clear} style={s(BUTTON)}>Cancel editing</button>}
      </form>
      {error && <EmptyNote role="alert">{error}</EmptyNote>}
      {message && <p role="status">{message}</p>}
    </main>
  </Frame>;
}
