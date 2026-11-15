import type {components} from '../contract/types';
import request from '../../mocks/request.json';
import {IS_MOCK, supabase} from '../supabase';
import {byDayThenStart, minToLabel} from '../time';
import {useRemote} from './local-store';

// Mock catalog. Row shapes follow supabase/DB_HANDOFF.md (terms, colleges, academic_programs, courses, section_bundles).
// Everything here is synthetic demo data, not an official UW list.

export type Term = {id: string; label: string; is_current: boolean};
export type College = {id: string; label: string};
export type Program = {id: string; college_id: string; label: string; catalog_year: number};
export type Meeting = components['schemas']['Meeting'];
export type Bundle = {bundle_id: string; summary: string; meetings: Meeting[]; instructor_score: number | null};
export type Course = {id: string; code: string; credit_options: number[]; bundles: Bundle[]};

export const TERMS: Term[] = [
  {id: '2026SP', label: 'Spring 2026 (demo)', is_current: false},
  {id: '2026FA', label: 'Fall 2026 (demo)', is_current: false},
  {id: '2027SP', label: 'Spring 2027 (demo)', is_current: true},
  {id: '2027FA', label: 'Fall 2027 (demo)', is_current: false},
];
export const CURRENT_TERM = TERMS.find((t) => t.is_current)!.id;
export const termLabel = (id: string) => TERMS.find((t) => t.id === id)?.label ?? id;

export const COLLEGES: College[] = [
  {id: 'demo-ls', label: 'Demo College of Letters and Science'},
  {id: 'demo-engr', label: 'Demo College of Engineering'},
];

export const PROGRAMS: Program[] = [
  {id: 'demo-cs-2026', college_id: 'demo-ls', label: 'Demo Computer Science', catalog_year: 2026},
  {id: 'demo-cs-2027', college_id: 'demo-ls', label: 'Demo Computer Science', catalog_year: 2027},
  {id: 'demo-stat-2027', college_id: 'demo-ls', label: 'Demo Statistics', catalog_year: 2027},
  {id: 'demo-engr-2027', college_id: 'demo-engr', label: 'Demo Engineering', catalog_year: 2027},
];

const NO_TERMS: Term[] = [];
async function fetchTerms(): Promise<Term[]> {
  const {data, error} = await supabase().from('terms').select('id, label, is_current').order('id');
  if (error) throw error;
  return data as Term[];
}
/** Terms from the active data source. */
export const useTerms: () => Term[] = IS_MOCK ? () => TERMS : () => useRemote('terms', NO_TERMS, fetchTerms);
/** Null when no term is flagged current; self-reported enrollment is then unavailable. Never guessed. */
export const currentTermOf = (terms: Term[]) => terms.find((t) => t.is_current)?.id ?? null;

export type CourseHit = {id: string; code: string; title: string | null; credit_options: number[]};

/** Course search by code. Real mode needs 2+ characters and returns at most 20 rows. */
export async function searchCourses(q: string): Promise<CourseHit[]> {
  const needle = q.trim().replace(/[%_,()]/g, ''); // keep LIKE wildcards and filter syntax out
  if (IS_MOCK) return COURSES.filter((c) => c.code.toLowerCase().includes(needle.toLowerCase())).map((c) => ({id: c.id, code: c.code, title: null, credit_options: c.credit_options}));
  if (needle.length < 2) return [];
  const {data, error} = await supabase().from('courses').select('id, code, title, credit_options').ilike('code', `%${needle}%`).order('code').limit(20);
  if (error) throw error;
  return data as CourseHit[];
}

/** Section bundles of one course in one term, with their meetings. Empty when the catalog has none. */
export async function getBundles(courseId: string, term: string): Promise<Bundle[]> {
  if (IS_MOCK) return term === CURRENT_TERM ? (COURSES.find((c) => c.id === courseId)?.bundles ?? []) : [];
  const db = supabase();
  const [bundles, meetings] = await Promise.all([
    db.from('section_bundles').select('bundle_id, instructor_score').eq('term', term).eq('course_id', courseId).order('bundle_id'),
    db.from('meetings').select('bundle_id, day, start_min, end_min, mode, building_id').eq('term', term).eq('course_id', courseId),
  ]);
  if (bundles.error) throw bundles.error;
  if (meetings.error) throw meetings.error;
  return bundles.data.map((b) => {
    const ms = (meetings.data as (Meeting & {bundle_id: string})[]).filter((m) => m.bundle_id === b.bundle_id).sort(byDayThenStart);
    return {
      bundle_id: b.bundle_id as string,
      instructor_score: b.instructor_score as number | null,
      meetings: ms.map((m) => ({day: m.day, start_min: m.start_min, end_min: m.end_min, mode: m.mode, building_id: m.building_id})),
      summary: ms.length ? `${[...new Set(ms.map((m) => dayShort(m.day)))].join('/')} ${minToLabel(ms[0].start_min)}` : 'No meeting times',
    };
  });
}

const NO_CODES: Record<string, string> = {};
/** Display codes for a set of course ids, e.g. to label community tags. Unknown ids are simply absent. */
export function useCourseCodes(ids: string[]): Record<string, string> {
  const unique = [...new Set(ids)].sort();
  return useRemote(`codes:${unique.join(',')}`, NO_CODES, async () => {
    if (IS_MOCK || unique.length === 0) return Object.fromEntries(COURSES.filter((c) => unique.includes(c.id)).map((c) => [c.id, c.code]));
    const {data, error} = await supabase().from('courses').select('id, code').in('id', unique);
    if (error) throw error;
    return Object.fromEntries((data as {id: string; code: string}[]).map((c) => [c.id, c.code]));
  });
}

type BundleRef = {term: string; course_id: string; bundle_id: string | null};
export const bundleKey = (r: BundleRef) => `${r.term}|${r.course_id}|${r.bundle_id}`;
const NO_BUNDLES: Record<string, Bundle> = {};

/** Bundles (meetings, instructor score) for saved records that name a section, keyed by `bundleKey`. */
export function useBundlesFor(refs: BundleRef[]): Record<string, Bundle> {
  const wanted = refs.filter((r) => r.bundle_id !== null);
  const cacheKey = `bundles:${wanted.map(bundleKey).sort().join(',')}`;
  return useRemote(cacheKey, NO_BUNDLES, async () => {
    const out: Record<string, Bundle> = {};
    await Promise.all(
      wanted.map(async (r) => {
        const match = (await getBundles(r.course_id, r.term)).find((b) => b.bundle_id === r.bundle_id);
        if (match) out[bundleKey(r)] = match;
      }),
    );
    return out;
  });
}

/** Dependent dropdown source: only the programs of one college. */
export function programsFor(collegeId: string): Program[] {
  return PROGRAMS.filter((p) => p.college_id === collegeId);
}

const dayShort = (d: string) => d[0] + d.slice(1, 3).toLowerCase();

export const COURSES: Course[] = [
  // Current-term courses with sections come from the shared fixture.
  ...request.courses.map((c) => ({
    id: c.course_id,
    code: c.course_code,
    credit_options: c.credit_options,
    bundles: c.section_bundles.map((b) => ({
      bundle_id: b.bundle_id,
      meetings: b.meetings as Meeting[], // JSON import widens the enums
      instructor_score: b.instructor_score as number | null,
      summary: b.meetings.length ? `${b.meetings.map((m) => dayShort(m.day)).join('/')} ${minToLabel(b.meetings[0].start_min)}` : 'No meeting times',
    })),
  })),
  // Courses without section data, for past-term history.
  {id: 'demo101', code: 'DEMO 101', credit_options: [3], bundles: []},
  {id: 'demo102', code: 'DEMO 102', credit_options: [4], bundles: []},
  {id: 'demo201', code: 'DEMO 201', credit_options: [3], bundles: []},
];
