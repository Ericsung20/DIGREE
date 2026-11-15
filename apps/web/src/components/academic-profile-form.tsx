'use client';

import {useState} from 'react';
import {field, primary} from '@/components/screen';
import {saveProfile, useAcademicOptions, useProfile} from '@/lib/data/profile';

type Draft = {college_id: string; label: string; program_id: string};
const EMPTY: Draft = {college_id: '', label: '', program_id: ''};

/** College -> Major (only that college's majors) -> catalog year. Used in onboarding and Profile. */
export function AcademicProfileForm({submitLabel, onSaved}: {submitLabel: string; onSaved?: () => void}) {
  const saved = useProfile();
  const {colleges, programs: options, ready} = useAcademicOptions();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const savedProgram = options.find((p) => p.id === saved?.program_id);
  const v = draft ?? (savedProgram ? {college_id: savedProgram.college_id, label: savedProgram.label, program_id: savedProgram.id} : EMPTY);
  const programs = options.filter((p) => p.college_id === v.college_id);
  const majors = [...new Set(programs.map((p) => p.label))];
  const years = programs.filter((p) => p.label === v.label).sort((a, b) => b.catalog_year - a.catalog_year);
  const chosen = years.find((p) => p.id === v.program_id);
  const change = (next: Draft) => {
    setDraft(next);
    setDone(false);
    setError(false);
  };

  if (!ready) return <p role="status" className="text-sm text-neutral-600">Loading academic programs…</p>;
  if (!options.length) return <p className="text-sm text-neutral-600">Academic programs are unavailable. You can still add courses and plan your schedule.</p>;

  return (
    <form
      className="surface space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!chosen || busy) return;
        setBusy(true);
        setError(false);
        try {
          await saveProfile({college_id: chosen.college_id, program_id: chosen.id, catalog_year: chosen.catalog_year});
          setDone(true);
          onSaved?.();
        } catch {
          setError(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm font-extrabold">
        College
        {/* Changing the college clears the major and year, so they can never mismatch. */}
        <select name="college" required value={v.college_id} onChange={(e) => change({college_id: e.target.value, label: '', program_id: ''})} className={field}>
          <option value="">Select a college</option>
          {colleges.filter((c) => options.some((p) => p.college_id === c.id)).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-extrabold">
        Major
        <select name="major" required disabled={!v.college_id} value={v.label} onChange={(e) => change({...v, label: e.target.value, program_id: ''})} className={field}>
          <option value="">{v.college_id ? 'Select a major' : 'Pick a college first'}</option>
          {majors.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-extrabold">
        Catalog year
        <select name="catalog_year" required disabled={!v.label} value={v.program_id} onChange={(e) => change({...v, program_id: e.target.value})} className={field}>
          <option value="">{v.label ? 'Select a year' : 'Pick a major first'}</option>
          {years.map((p) => (
            <option key={p.id} value={p.id}>
              {p.catalog_year}–{String(p.catalog_year + 1).slice(-2)}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-accent">Couldn’t save your profile. Try again.</p>}
      <button type="submit" disabled={!chosen || busy} className={primary}>
        {busy ? 'Saving…' : submitLabel}
      </button>
      {done && (
        <p role="status" className="text-center text-xs text-neutral-600">
          Saved
        </p>
      )}
    </form>
  );
}
