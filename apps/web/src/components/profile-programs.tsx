'use client';

import {useState, type FormEvent} from 'react';
import {
  addProfileProgram, MAJOR_LIMIT_MESSAGE, MAX_ADDITIONAL_MAJORS, removeProfileProgram,
  useProfilePrograms, useSupplementalCatalog, type ProfileProgramDraft,
} from '@/lib/data/profile-programs';
import {latestCatalogEdition, useAcademicOptions} from '@/lib/data/profile';
import styles from './profile-programs.module.css';

const KINDS = {major: 'Major', certificate: 'Certificate', minor: 'Minor'} as const;
type Kind = keyof typeof KINDS;

export function ProfilePrograms({primaryId}: {primaryId: string}) {
  const {colleges, programs} = useAcademicOptions();
  const entries = useProfilePrograms();
  const catalog = useSupplementalCatalog();
  const [kind, setKind] = useState<Kind | null>(null);
  const [college, setCollege] = useState('');
  const [major, setMajor] = useState('');
  const [supplementalName, setSupplementalName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const atMajorLimit = entries.filter((entry) => entry.kind === 'major').length >= MAX_ADDITIONAL_MAJORS;

  const saved = programs.filter((program) => program.id === primaryId || entries.some((entry) => entry.program_id === program.id));
  const available = programs.filter((program) => !saved.some((item) => item.college_id === program.college_id && item.label === program.label));
  const majors = [...new Set(available.filter((program) => program.college_id === college).map((program) => program.label))];
  const chosenMajor = latestCatalogEdition(available.filter((program) => program.college_id === college && program.label === major));
  const byKind = catalog.programs.filter((program) => program.kind === kind);
  // A Guide path may change when a program moves departments. Group by title and save the matching edition's key.
  const offered = byKind.filter((program) => !entries.some((entry) => entry.kind === kind
    && (entry.supplemental_program_key === program.program_key || entry.name?.toLowerCase() === program.name.toLowerCase())));
  const supplementalOptions = [...new Set(offered.map((program) => program.name))].sort((a, b) => a.localeCompare(b));
  const chosenSupplemental = latestCatalogEdition(offered.filter((program) => program.name === supplementalName));

  function open(next: Kind) {
    setCollege('');
    setMajor('');
    setSupplementalName('');
    setError('');
    setKind(next);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || busy) return;
    if (kind === 'major' && atMajorLimit) {
      setError(MAJOR_LIMIT_MESSAGE);
      return;
    }
    let draft: ProfileProgramDraft;
    if (kind === 'major' && chosenMajor) {
      draft = {kind, program_id: chosenMajor.id, name: null, catalog_year: null};
    } else if (kind !== 'major' && chosenSupplemental) {
      draft = {
        kind, program_id: null, name: chosenSupplemental.name, catalog_year: chosenSupplemental.catalog_year,
        supplemental_program_key: chosenSupplemental.program_key,
      };
    } else {
      setError(`Choose a ${kind}.`);
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
          return <li key={entry.id} className={styles.entry}>
            <div>
              <span className={styles.meta}>{KINDS[entry.kind]}</span>
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
          <button key={item} type="button" disabled={busy || (item === 'major' && atMajorLimit)} aria-expanded={kind === item} onClick={() => open(item)}>+ {KINDS[item]}</button>
        ))}
      </div>
      {atMajorLimit && <p className={styles.error}>{MAJOR_LIMIT_MESSAGE}</p>}
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
            </> : supplementalOptions.length > 0 ? <>
              <label>{KINDS[kind]}
                <select value={supplementalName} required onChange={(event) => setSupplementalName(event.target.value)}>
                  <option value="">Choose a {kind}</option>
                  {supplementalOptions.map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
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
