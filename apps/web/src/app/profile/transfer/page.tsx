'use client';

import {useRef, useState} from 'react';
import {BackLink, EmptyNote, Frame} from '@/components/dg';
import {displayCourseCode} from '@/lib/course-identity';
import {currentTermOf, searchCourses, useCourseDetails, useTerms, type CourseHit} from '@/lib/data/catalog';
import {removeTransferCredit, saveTransferCredit, useTransferCredits} from '@/lib/data/transfer-credits';
import {s} from '@/lib/ui/css';

const FIELD = 'display: grid; gap: 6px; font-size: 14px; font-weight: 800';
const INPUT = 'min-height: 44px; width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #DAD5CE; border-radius: 12px; font: inherit';
const BUTTON = 'min-height: 44px; border: none; border-radius: 14px; padding: 10px 14px; font: inherit; font-weight: 800; cursor: pointer';

export default function TransferPage() {
  const transfers = useTransferCredits();
  const terms = useTerms();
  const current = currentTermOf(terms);
  const recognizedTerms = current ? terms.filter(term => terms.indexOf(term) <= terms.findIndex(item => item.id === current)) : terms;
  const details = useCourseDetails(transfers.flatMap(row => row.equivalent_course_id ? [row.equivalent_course_id] : []));
  const [editing, setEditing] = useState<string | undefined>();
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
  const [confirmed, setConfirmed] = useState(false);
  const searchTicket = useRef(0);

  function clear() {
    setEditing(undefined); setInstitution(''); setSourceCourse(''); setCredits('3');
    setTerm(''); setNotes(''); setEquivalent(null); setQuery(''); setHits([]); setConfirmed(false); ++searchTicket.current;
  }

  return <Frame css="input,select,textarea,button{font:inherit}" numeric>
    <header style={s('display: flex; align-items: center; gap: 8px; padding: 12px')}>
      <BackLink href="/profile" label="Back to profile" /><h1 style={s('font-size: 24px; margin: 0')}>Transfer credit</h1>
    </header>
    <main style={s('flex: 1; overflow: auto; padding: 8px 20px 24px; display: flex; flex-direction: column; gap: 16px')}>
      <p style={s('margin: 0; color: #5F5A55; line-height: 1.5')}>Record credits UW has recognized from another school. A UW equivalent can satisfy course checks; general transfer credit counts toward your credit estimate. Transfer grades are excluded from UW GPA and residency requirements.</p>
      {transfers.map(row => <section key={row.id} style={s('padding: 16px; border-radius: 20px; background: #FFFFFF; display: grid; gap: 8px')}>
        <strong>{row.institution} · {row.source_course}</strong>
        <span>{row.credits} cr · {terms.find(item => item.id === row.awarded_term)?.label ?? row.awarded_term}</span>
        <span>{row.equivalent_course_id ? `UW equivalent: ${details[row.equivalent_course_id] ? displayCourseCode(details[row.equivalent_course_id]) : row.equivalent_course_id}` : 'General transfer credit'}</span>
        {row.notes && <span>{row.notes}</span>}
        <div style={s('display: flex; gap: 8px')}>
          <button disabled={busy} style={s(BUTTON)} onClick={() => {
            setEditing(row.id); setInstitution(row.institution); setSourceCourse(row.source_course); setCredits(String(row.credits));
            setTerm(row.awarded_term); setNotes(row.notes); setError(''); setMessage(''); setHits([]); setQuery(''); setConfirmed(false); ++searchTicket.current;
            setEquivalent(row.equivalent_course_id ? details[row.equivalent_course_id] ?? {id: row.equivalent_course_id, code: row.equivalent_course_id} : null);
          }}>Edit</button>
          <button disabled={busy} style={s(BUTTON)} onClick={async () => {
            setBusy(true); setError('');
            try { await removeTransferCredit(row.id); if (editing === row.id) clear(); setMessage('Transfer credit removed.'); }
            catch { setError('Couldn’t remove this transfer credit.'); } finally { setBusy(false); }
          }}>Remove</button>
        </div>
      </section>)}
      <form style={s('display: grid; gap: 14px; background: #FFFFFF; padding: 16px; border-radius: 20px')} onSubmit={async event => {
        event.preventDefault(); if (busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
          await saveTransferCredit({institution, source_course: sourceCourse, credits: Number(credits), awarded_term: term || current || '', equivalent_course_id: equivalent?.id ?? null, notes}, editing);
          clear(); setMessage('Transfer credit saved.');
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t save transfer credit.'); }
        finally { setBusy(false); }
      }}>
        <h2 style={s('font-size: 19px; margin: 0')}>{editing ? 'Edit recognized credit' : 'Add recognized credit'}</h2>
        <label style={s(FIELD)}>Source school<input required maxLength={160} value={institution} onChange={event => setInstitution(event.target.value)} style={s(INPUT)} /></label>
        <label style={s(FIELD)}>Source course<input required maxLength={160} value={sourceCourse} onChange={event => setSourceCourse(event.target.value)} style={s(INPUT)} /></label>
        <label style={s(FIELD)}>Recognized credits<input required type="number" min="0.01" max="30" step="0.01" value={credits} onChange={event => setCredits(event.target.value)} style={s(INPUT)} /></label>
        <label style={s(FIELD)}>Recognized by semester<select required value={term || current || ''} onChange={event => setTerm(event.target.value)} style={s(INPUT)}>
          <option value="">Choose a semester</option>{recognizedTerms.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label style={s(FIELD)}>UW equivalent (optional)<input value={query} placeholder="Search CS 240 or MATH 240" style={s(INPUT)} onChange={async event => {
          const value = event.target.value; setQuery(value); const ticket = ++searchTicket.current;
          try { const result = await searchCourses(value); if (ticket === searchTicket.current) setHits(result); }
          catch { if (ticket === searchTicket.current) setError('Couldn’t search UW courses.'); }
        }} /></label>
        {hits.slice(0, 6).map(hit => <button key={hit.id} type="button" style={s(BUTTON)} onClick={() => { setEquivalent(hit); setHits([]); setQuery(''); ++searchTicket.current; }}>{displayCourseCode(hit)} · {hit.title}</button>)}
        {equivalent && <div>Equivalent: <strong>{displayCourseCode(equivalent)}</strong> <button type="button" onClick={() => setEquivalent(null)}>Clear equivalent</button></div>}
        <label style={s(FIELD)}>Notes (optional)<textarea maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} style={s(INPUT)} /></label>
        <label style={s('font-size: 13px; line-height: 1.5')}><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> These credits and the selected equivalence match my UW transfer credit evaluation.</label>
        <button disabled={busy} style={s(BUTTON + '; background: #8C1D2B; color: #FFFFFF')}>{busy ? 'Saving…' : 'Save transfer credit'}</button>
        {editing && <button type="button" disabled={busy} onClick={clear} style={s(BUTTON)}>Cancel editing</button>}
      </form>
      {error && <EmptyNote role="alert">{error}</EmptyNote>}
      {message && <p role="status">{message}</p>}
    </main>
  </Frame>;
}
