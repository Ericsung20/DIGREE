'use client';

import {useState} from 'react';
import {field, primary} from '@/components/screen';
import {COLLEGES, PROGRAMS, programsFor} from '@/lib/data/catalog';
import {saveProfile, useProfile} from '@/lib/data/profile';

type Draft = {college_id: string; label: string; program_id: string};
const EMPTY: Draft = {college_id: '', label: '', program_id: ''};

/** College -> Major (only that college's majors) -> catalog year. Used in onboarding and Profile. */
export function AcademicProfileForm({submitLabel, onSaved}: {submitLabel: string; onSaved?: () => void}) {
  const saved = useProfile();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [done, setDone] = useState(false);

  const savedProgram = PROGRAMS.find((p) => p.id === saved?.program_id);
  const v = draft ?? (savedProgram ? {college_id: savedProgram.college_id, label: savedProgram.label, program_id: savedProgram.id} : EMPTY);
  const programs = programsFor(v.college_id);
  const majors = [...new Set(programs.map((p) => p.label))];
  const years = programs.filter((p) => p.label === v.label);
  const chosen = years.find((p) => p.id === v.program_id);
  const change = (next: Draft) => {
    setDraft(next);
    setDone(false);
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen) return;
        saveProfile({college_id: chosen.college_id, program_id: chosen.id, catalog_year: chosen.catalog_year});
        setDone(true);
        onSaved?.();
      }}
    >
      <label className="block text-xs text-neutral-600">
        College
        {/* Changing the college clears the major and year, so they can never mismatch. */}
        <select name="college" required value={v.college_id} onChange={(e) => change({college_id: e.target.value, label: '', program_id: ''})} className={field}>
          <option value="">Select a college</option>
          {COLLEGES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-neutral-600">
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
      <label className="block text-xs text-neutral-600">
        Catalog year
        <select name="catalog_year" required disabled={!v.label} value={v.program_id} onChange={(e) => change({...v, program_id: e.target.value})} className={field}>
          <option value="">{v.label ? 'Select a year' : 'Pick a major first'}</option>
          {years.map((p) => (
            <option key={p.id} value={p.id}>
              {p.catalog_year}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-neutral-600">Demo program list. Your catalog year can differ from the year you started.</p>
      <button type="submit" disabled={!chosen} className={primary}>
        {submitLabel}
      </button>
      {done && (
        <p role="status" className="text-center text-xs text-neutral-600">
          Saved
        </p>
      )}
    </form>
  );
}
