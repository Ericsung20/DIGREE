'use client';

import {useState, type FormEvent} from 'react';
import {
  addProfileProgram, removeProfileProgram, useProfilePrograms, useSupplementalCatalog, type ProfileProgramDraft,
} from '@/lib/data/profile-programs';
import {useAcademicOptions} from '@/lib/data/profile';
import styles from './profile-programs.module.css';

const KINDS = {major: 'Major', certificate: 'Certificate', minor: 'Minor'} as const;
type Kind = keyof typeof KINDS;
const yearLabel = (year: number) => `${year}–${String(year + 1).slice(-2)}`;

export function ProfilePrograms({primaryId}: {primaryId: string}) {
  const {colleges, programs} = useAcademicOptions();
  const entries = useProfilePrograms();
  const catalog = useSupplementalCatalog();
  const [kind, setKind] = useState<Kind | null>(null);
  const [college, setCollege] = useState('');
  const [major, setMajor] = useState('');
  const [supplementalName, setSupplementalName] = useState('');
  const [supplementalYear, setSupplementalYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const saved = programs.filter((program) => program.id === primaryId || entries.some((entry) => entry.program_id === program.id));
  const available = programs.filter((program) => !saved.some((item) => item.college_id === program.college_id && item.label === program.label));
  const majors = [...new Set(available.filter((program) => program.college_id === college).map((program) => program.label))];
  const years = available.filter((program) => program.college_id === college && program.label === major)
    .sort((a, b) => b.catalog_year - a.catalog_year);
  const byKind = catalog.programs.filter((program) => program.kind === kind);
  // A Guide path may change when a program moves departments. Select by title, then save the chosen edition's key.
  const offered = byKind.filter((program) => !entries.some((entry) => entry.kind === kind
    && (entry.supplemental_program_key === program.program_key || entry.name?.toLowerCase() === program.name.toLowerCase())));
  const supplementalOptions = [...new Set(offered.map((program) => program.name))].sort((a, b) => a.localeCompare(b));
  const supplementalYears = offered.filter((program) => program.name === supplementalName);
  const chosenSupplemental = supplementalYears.find((program) => String(program.catalog_year) === supplementalYear);

  function open(next: Kind) {
    setCollege('');
    setMajor('');
    setSupplementalName('');
    setSupplementalYear('');
    setError('');
    setKind(next);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || busy) return;
    const fields = new FormData(event.currentTarget);
    const year = String(fields.get('year') ?? '');
    const supplemental = supplementalYears.find((program) => program.catalog_year === Number(year));
    let draft: ProfileProgramDraft;
    if (kind === 'major' && years.some((program) => program.id === year)) {
      draft = {kind, program_id: year, name: null, catalog_year: null};
    } else if (kind !== 'major' && supplemental) {
      draft = {
        kind, program_id: null, name: supplemental.name, catalog_year: supplemental.catalog_year,
        supplemental_program_key: supplemental.program_key,
      };
    } else {
      setError(`Choose the ${kind} and its catalog year.`);
      return;
    }

    setBusy(true);
    setError('');
    try {
      await addProfileProgram(draft);
      setKind(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Couldn’t save this program. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError('');
    try {
      await removeProfileProgram(id);
    } catch {
      setError('Couldn’t remove this program. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.programs}>
      {entries.length > 0 && <ul className={styles.list} aria-label="Additional programs">
        {entries.map((entry) => {
          const program = programs.find((item) => item.id === entry.program_id);
          const official = catalog.programs.find((item) => item.program_key === entry.supplemental_program_key
            && item.catalog_year === entry.catalog_year && item.kind === entry.kind);
          const name = official?.name ?? entry.name ?? program?.label ?? 'Catalog major';
          const year = program?.catalog_year ?? entry.catalog_year;
          return <li key={entry.id} className={styles.entry}>
            <div>
              <span className={styles.meta}>{KINDS[entry.kind]}{year && ` · ${yearLabel(year)} Guide`}</span>
              <strong>{official?.source_url?.startsWith('https://guide.wisc.edu/')
                ? <a href={official.source_url} target="_blank" rel="noreferrer">{name}</a>
                : name}</strong>
            </div>
            <button type="button" className={styles.remove} aria-label={`Remove ${name}`} disabled={busy} onClick={() => void remove(entry.id)}>Remove</button>
          </li>;
        })}
      </ul>}
      <div className={styles.actions}>
        {(Object.keys(KINDS) as Kind[]).map((item) => (
          <button key={item} type="button" disabled={busy} aria-expanded={kind === item} onClick={() => open(item)}>+ {KINDS[item]}</button>
        ))}
      </div>
      {kind && (
        <form key={kind} className={styles.editor} onSubmit={add}>
          <h3>Add {kind === 'major' ? 'another major' : `a ${kind}`}</h3>
          <fieldset disabled={busy}>
            {kind === 'major' ? <>
              <label>College
                <select value={college} required onChange={(event) => { setCollege(event.target.value); setMajor(''); }}>
                  <option value="">Choose a college</option>
                  {colleges.filter((item) => available.some((program) => program.college_id === item.id))
                    .map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label>Major
                <select value={major} required disabled={!college} onChange={(event) => setMajor(event.target.value)}>
                  <option value="">Choose a major</option>
                  {majors.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>Catalog year
                <select key={major} name="year" required disabled={!major} defaultValue="">
                  <option value="">Choose a Guide year</option>
                  {years.map((program) => <option key={program.id} value={program.id}>{yearLabel(program.catalog_year)}</option>)}
                </select>
              </label>
              <p>Use the Guide year listed for this major in DARS.</p>
            </> : supplementalOptions.length > 0 ? <>
              <label>{KINDS[kind]}
                <select value={supplementalName} required onChange={(event) => {
                  setSupplementalName(event.target.value);
                  setSupplementalYear('');
                }}>
                  <option value="">Choose a {kind}</option>
                  {supplementalOptions.map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
              <label>Catalog year
                <select name="year" required disabled={!supplementalName} value={supplementalYear}
                  onChange={(event) => setSupplementalYear(event.target.value)}>
                  <option value="">Choose a Guide year</option>
                  {supplementalYears.map((program) => (
                    <option key={program.catalog_year} value={program.catalog_year}>{yearLabel(program.catalog_year)}</option>
                  ))}
                </select>
              </label>
              <p>Use the Guide year listed for this {kind} in DARS.</p>
              {chosenSupplemental?.source_url?.startsWith('https://guide.wisc.edu/') &&
                <p><a href={chosenSupplemental.source_url} target="_blank" rel="noreferrer">View requirements in the UW Guide</a></p>}
            </> : (
              <p role="status">{!catalog.ready ? 'Loading the UW Guide catalog…'
                : !catalog.available ? 'The UW Guide catalog is currently unavailable.'
                : byKind.length > 0 ? `All available ${kind}s are already in your profile.`
                : `No ${kind} entries are available in the catalog yet.`}</p>
            )}
            <div className={styles.actions}>
              {(kind === 'major' || supplementalOptions.length > 0) &&
                <button type="submit" className={styles.save}>{busy ? 'Saving…' : `Save ${kind}`}</button>}
              <button type="button" onClick={() => { setKind(null); setError(''); }}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  );
}
