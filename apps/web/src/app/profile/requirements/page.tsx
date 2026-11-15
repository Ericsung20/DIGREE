'use client';

import Link from 'next/link';
import {useEffect, useRef, useState} from 'react';
import {EmptyState, Screen, field, secondary} from '@/components/screen';
import {useCourseRecords, useGrades} from '@/lib/data/course-records';
import {removeDarsProgress, saveDarsProgress, useDarsProgress} from '@/lib/data/degree-progress';
import {useAcademicOptions, useProfile} from '@/lib/data/profile';

const UW_GUIDE = 'https://guide.wisc.edu/undergraduate/';
const CS_GUIDE = 'https://guide.wisc.edu/undergraduate/letters-science/computer-sciences/computer-sciences-bs/';

function DarsChecklist({programId}: {programId: string}) {
  const items = useDarsProgress(programId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(action: () => Promise<string | null>, onSaved?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const message = await action();
      if (message) setError(message);
      else onSaved?.();
    } catch {
      setError('Couldn’t save your degree progress.');
    } finally {setBusy(false);}
  }
  return <section className="surface mt-3 space-y-3">
    <h2 className="section-title">Requirements from your report</h2>
    <p className="text-sm text-neutral-600">Enter a requirement and its remaining credits as shown in DARS. These entries are private to your account.</p>
    <ul className="divide-y divide-neutral-200">
      {items.map((item) => <li key={item.requirement_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <span className="wrap-anywhere"><strong>{item.requirement_id}</strong> · {item.credits_remaining} cr remaining</span>
        <button type="button" className="text-accent" disabled={busy} onClick={() => void save(() => removeDarsProgress(programId, item.requirement_id))}>Remove</button>
      </li>)}
    </ul>
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      void save(() => saveDarsProgress(programId, {requirement_id: String(values.get('requirement')), credits_remaining: Number(values.get('remaining'))}), () => form.reset());
    }}>
      <label className="block text-sm font-extrabold">Requirement <input name="requirement" className={field} maxLength={120} required /></label>
      <label className="block text-sm font-extrabold">Credits remaining <input name="remaining" className={field} type="number" min={0} max={200} required /></label>
      <button className={secondary} type="submit" disabled={busy}>Save requirement</button>
    </form>
    {error && <p role="alert" className="text-sm text-accent">{error}</p>}
  </section>;
}

export default function RequirementsPage() {
  const profile = useProfile();
  const {programs} = useAcademicOptions();
  const records = useCourseRecords();
  const grades = useGrades();
  const [mode, setMode] = useState<'courses' | 'dars'>('courses');
  const [documentUrl, setDocumentUrl] = useState('');
  const [error, setError] = useState('');
  const fileRequest = useRef(0);
  useEffect(() => () => {if (documentUrl) URL.revokeObjectURL(documentUrl);}, [documentUrl]);
  const program = programs.find((item) => item.id === profile?.program_id);
  const completed = records.filter((item) => item.status === 'completed' && grades[item.id] !== 'F');
  const credits = completed.reduce((total, item) => total + item.credits, 0);
  const isCurrentCs = program?.label === 'Computer Sciences, BS' && program.catalog_year === 2026;
  const source = program && program.catalog_year < 2026 ? 'https://guide.wisc.edu/archive/' : isCurrentCs ? CS_GUIDE : UW_GUIDE;
  return (
    <Screen title="Degree requirements" back={{href: '/profile', label: 'Back to profile'}}
      description={program ? `${program.label} · ${program.catalog_year}–${String(program.catalog_year + 1).slice(-2)} Guide` : undefined}>
      <div role="group" aria-label="Review source" className="mb-3 flex flex-wrap gap-2">
        <button type="button" className="choice-chip" aria-pressed={mode === 'courses'} onClick={() => setMode('courses')}>From my courses</button>
        <button type="button" className="choice-chip" aria-pressed={mode === 'dars'} onClick={() => setMode('dars')}>From DARS PDF</button>
      </div>
      {mode === 'courses' ? <>
        {!program ? <EmptyState title="Choose your program" body="Set your major and catalog year in Profile." /> : (
          <section className="surface space-y-3">
            <h2 className="section-title">University credit minimum</h2>
            <p><strong>{credits} credits reported</strong> · {Math.max(0, 120 - credits)} to reach 120</p>
            <progress aria-label="Reported credits toward the university minimum" className="h-3 w-full accent-accent" max={120} value={Math.min(credits, 120)} />
            <p className="text-sm text-neutral-600">This estimate uses the completed courses you entered. Use DARS to confirm transfer credits, residency, and your full degree and general education requirements.</p>
            <a className="text-sm font-extrabold text-accent underline" href={source}>Open UW Guide requirements</a>
          </section>
        )}
        {isCurrentCs && <section className="surface mt-3 space-y-2">
          <h2 className="section-title">Programming core</h2>
          <ul className="divide-y divide-neutral-200">
            {['COMP SCI 300', 'COMP SCI 400'].map((code) => (
              <li className="flex justify-between gap-2 py-2 text-sm" key={code}><strong>{code}</strong><span>{completed.some((item) => item.course_code === code) ? 'Reported complete' : 'Check in DARS'}</span></li>
            ))}
          </ul>
        </section>}
        <Link className={`${secondary} mt-4 w-full`} href="/profile#course-history">Edit course history</Link>
      </> : <>
        <section className="surface space-y-3">
          <h2 className="section-title">Review your DARS report</h2>
          <p className="text-sm text-neutral-600">Choose a PDF saved from UW DARS. It opens in this browser and stays on this device.</p>
          <input type="file" aria-label="Choose a DARS PDF" accept="application/pdf,.pdf" className={field} onChange={async (event) => {
            const file = event.target.files?.[0];
            const ticket = ++fileRequest.current;
            setDocumentUrl('');
            setError('');
            if (!file) return;
            try {
              const signature = await file.slice(0, 5).text();
              if (ticket !== fileRequest.current) return;
              if (signature !== '%PDF-') return setError('Choose a valid PDF.');
              setDocumentUrl(URL.createObjectURL(new Blob([file], {type: 'application/pdf'})));
            } catch {setError('Couldn’t read the PDF.');}
          }} />
          {error && <p role="alert" className="text-sm text-accent">{error}</p>}
          {documentUrl && <>
            <a href={documentUrl} target="_blank" rel="noreferrer" className={secondary}>Open PDF in a new tab</a>
            <iframe title="DARS PDF preview" src={documentUrl} className="h-[65vh] w-full rounded-xl bg-neutral-100" />
          </>}
          <p className="text-sm"><a className="font-extrabold text-accent underline" href="https://registrar.wisc.edu/dars/">Get a report from UW DARS</a></p>
        </section>
        {program && <DarsChecklist programId={program.id} />}
      </>}
    </Screen>
  );
}
