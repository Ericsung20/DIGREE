import type {LetterGrade} from '../gpa';
import {IS_MOCK, supabase} from '../supabase';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

// Same columns and enum as user_course_records in the DB handoff.
export type CourseRecordStatus = 'planned' | 'enrolled_self_reported' | 'completed' | 'withdrawn';
export type CourseRecord = {
  id: string;
  term: string;
  course_id: string;
  /** Display code, joined from courses. Missing on rows saved before this field existed. */
  course_code?: string;
  credits: number;
  status: CourseRecordStatus;
  bundle_id: string | null;
  counts_toward_major: boolean;
  source: 'manual';
};
export type CourseRecordDraft = Omit<CourseRecord, 'id'>;

/** Labels shown in Course History. */
export const STATUS_LABEL: Record<CourseRecordStatus, string> = {
  completed: 'Completed',
  enrolled_self_reported: 'Taking now',
  planned: 'Planned — not registered',
  withdrawn: 'Withdrawn',
};

const KEY = 'digree.course_records';
const EMPTY: CourseRecord[] = [];
const COLUMNS = 'id, term, course_id, credits, status, bundle_id, counts_toward_major, source, courses(code)';

type Row = Omit<CourseRecord, 'course_code'> & {courses: {code: string} | null};
const fromRow = ({courses, ...r}: Row): CourseRecord => ({...r, course_code: courses?.code});

// Row Level Security limits these queries to the signed-in user's own rows.
async function fetchRecords(): Promise<CourseRecord[]> {
  const {data, error} = await supabase().from('user_course_records').select(COLUMNS).order('term');
  if (error) throw error;
  return (data as unknown as Row[]).map(fromRow);
}

const current = () => (IS_MOCK ? readStore(KEY, EMPTY) : getRemote(KEY, EMPTY));
const put = (next: CourseRecord[]) => (IS_MOCK ? writeStore(KEY, next) : setRemote(KEY, next));

export const useCourseRecords: () => CourseRecord[] = IS_MOCK ? () => useStore(KEY, EMPTY) : () => useRemote(KEY, EMPTY, fetchRecords);

/** Returns a user-facing error, or null when the draft can be added. */
export function validateRecord(existing: CourseRecord[], draft: CourseRecordDraft, currentTerm: string | null): string | null {
  if (existing.some((r) => r.term === draft.term && r.course_id === draft.course_id)) return 'Already added for this term.';
  if (draft.status === 'enrolled_self_reported' && draft.term !== currentTerm) return 'Taking now is available for the current term only.';
  return null;
}

export async function addCourseRecord(draft: CourseRecordDraft, currentTerm: string | null): Promise<string | null> {
  const invalid = validateRecord(current(), draft, currentTerm);
  if (invalid) return invalid;
  if (IS_MOCK) {
    put([...current(), {...draft, id: crypto.randomUUID()}]);
    return null;
  }
  const db = supabase();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) return 'Sign in to save courses.';
  // course_code is display-only and not a column, so it is left out of the insert.
  const {term, course_id, credits, status, bundle_id, counts_toward_major, source} = draft;
  const row = {term, course_id, credits, status, bundle_id, counts_toward_major, source, user_id: auth.user.id};
  const {data, error} = await db.from('user_course_records').insert(row).select(COLUMNS).single();
  if (error) return error.message;
  put([...current(), fromRow(data as unknown as Row)]);
  return null;
}

export async function setCountsTowardMajor(id: string, value: boolean): Promise<void> {
  if (!IS_MOCK) {
    const {error} = await supabase().from('user_course_records').update({counts_toward_major: value}).eq('id', id);
    if (error) return console.error('Saving the major flag failed', error);
  }
  put(current().map((r) => (r.id === id ? {...r, counts_toward_major: value} : r)));
}

export async function changeCourseSection(id: string, bundleId: string): Promise<string | null> {
  if (!IS_MOCK) {
    const {error} = await supabase().from('user_course_records').update({bundle_id: bundleId}).eq('id', id).eq('status', 'enrolled_self_reported');
    if (error) return error.message;
  }
  put(current().map((record) => record.id === id ? {...record, bundle_id: bundleId} : record));
  return null;
}

// Grades live apart from the records, like grade_entries (keyed by record_id) in the DB handoff.
// Grades are entered by the user and readable only by them (owner-only RLS). They are never sent anywhere else.
type Grades = Record<string, LetterGrade>;
const GRADES_KEY = 'digree.grades';
const NO_GRADES: Grades = {};

async function fetchGrades(): Promise<Grades> {
  const {data, error} = await supabase().from('grade_entries').select('record_id, letter_grade');
  if (error) throw error;
  const rows = data as {record_id: string; letter_grade: LetterGrade | null}[];
  return Object.fromEntries(rows.flatMap((g) => (g.letter_grade ? [[g.record_id, g.letter_grade]] : [])));
}

const currentGrades = () => (IS_MOCK ? readStore(GRADES_KEY, NO_GRADES) : getRemote(GRADES_KEY, NO_GRADES));
function putGrade(recordId: string, grade: LetterGrade | null): void {
  const next = {...currentGrades()};
  if (grade) next[recordId] = grade;
  else delete next[recordId];
  if (IS_MOCK) writeStore(GRADES_KEY, next);
  else setRemote(GRADES_KEY, next);
}

export const useGrades: () => Grades = IS_MOCK ? () => useStore(GRADES_KEY, NO_GRADES) : () => useRemote(GRADES_KEY, NO_GRADES, fetchGrades);

/** `isFinal` is true for completed courses; a current-term grade is a projection. */
export async function setGrade(recordId: string, grade: LetterGrade | null, isFinal: boolean): Promise<void> {
  if (!IS_MOCK) {
    const table = supabase().from('grade_entries');
    const {error} = grade ? await table.upsert({record_id: recordId, letter_grade: grade, is_final: isFinal}) : await table.delete().eq('record_id', recordId);
    if (error) return console.error('Saving the grade failed', error);
  }
  putGrade(recordId, grade);
}

export async function removeCourseRecord(id: string): Promise<void> {
  if (!IS_MOCK) {
    // grade_entries rows go with the record (ON DELETE CASCADE).
    const {error} = await supabase().from('user_course_records').delete().eq('id', id);
    if (error) return console.error('Removing the course failed', error);
  }
  putGrade(id, null);
  put(current().filter((r) => r.id !== id));
}
