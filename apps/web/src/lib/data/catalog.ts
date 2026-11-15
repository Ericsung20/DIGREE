import type {components} from '../contract/types';
import request from '../../mocks/request.json';
import {IS_MOCK, supabase} from '../supabase';
import {byDayThenStart, minToLabel} from '../time';
import {displayTerm} from '../terms';
import {useRemote} from './local-store';

// Mock catalog. Row shapes follow supabase/DB_HANDOFF.md (terms, colleges, academic_programs, courses, section_bundles).
// Everything here is synthetic demo data, not an official UW list.

export type Term = {id: string; label: string; is_current: boolean};
export type College = {id: string; label: string};
export type Program = {id: string; college_id: string; label: string; catalog_year: number};
export type Meeting = components['schemas']['Meeting'];
export type Bundle = {bundle_id: string; label: string; summary: string; meetings: Meeting[]; instructor_score: number | null; instructors: string[]};
export type Course = {id: string; code: string; credit_options: number[]; bundles: Bundle[]};

export const TERMS: Term[] = [
  {id: '2026SP', label: 'Spring 2026', is_current: false},
  {id: '2026FA', label: 'Fall 2026', is_current: false},
  {id: '2027SP', label: 'Spring 2027', is_current: true},
  {id: '2027FA', label: 'Fall 2027', is_current: false},
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
  return (data as Term[]).map((term) => ({...term, label: displayTerm(term.label)}));
}
/** Terms from the active data source. */
export const useTerms: () => Term[] = IS_MOCK ? () => TERMS : () => useRemote('terms', NO_TERMS, fetchTerms);
/** Null when no term is flagged current; self-reported enrollment is then unavailable. Never guessed. */
export const currentTermOf = (terms: Term[]) => terms.find((t) => t.is_current)?.id ?? null;

export type CourseHit = {id: string; code: string; title: string | null; credit_options: number[]};

// Synthetic titles for the mock catalog, so screens that show a course name have one.
const MOCK_TITLES: Record<string, string> = {
  cs400: 'Programming III',
  math234: 'Calculus: Functions of Several Variables',
  stat240: 'Data Science Modeling I',
  demo101: 'Demo Seminar',
  demo102: 'Demo Lab',
  demo201: 'Demo Studio',
};
const mockHit = (course: Course): CourseHit => ({id: course.id, code: course.code, title: MOCK_TITLES[course.id] ?? null, credit_options: course.credit_options});

export function useCourseInfo(id: string | null) {
  return useRemote<CourseHit | null>(`course:${id}`, null, async () => {
    if (!id) return null;
    if (IS_MOCK) {
      const course = COURSES.find((item) => item.id === id);
      return course ? mockHit(course) : null;
    }
    const {data, error} = await supabase().from('courses').select('id, code, title, credit_options').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  });
}

const NO_COURSES: Record<string, CourseHit> = {};
/** Code, title and credits for a set of course ids. Unknown ids are simply absent. */
export function useCourseDetails(ids: string[]): Record<string, CourseHit> {
  const unique = [...new Set(ids)].sort();
  return useRemote(`courses:${unique.join(',')}`, NO_COURSES, async () => {
    if (!unique.length) return NO_COURSES;
    if (IS_MOCK) return Object.fromEntries(COURSES.filter((course) => unique.includes(course.id)).map((course) => [course.id, mockHit(course)]));
    const {data, error} = await supabase().from('courses').select('id, code, title, credit_options').in('id', unique);
    if (error) throw error;
    return Object.fromEntries((data as CourseHit[]).map((course) => [course.id, course]));
  });
}

/** The term just before the current one: where a course marked "taken" is filed. */
export function previousTermOf(terms: Term[]): string | null {
  const current = terms.findIndex((term) => term.is_current);
  if (current > 0) return terms[current - 1].id;
  return current === 0 ? null : terms.at(-1)?.id ?? null;
}

const NO_NAMES: Record<string, string> = {};
export function useBuildingNames(ids: string[]) {
  const buildings = [...new Set(ids)].sort();
  return useRemote(`building-names:${JSON.stringify(buildings)}`, NO_NAMES, async () => {
    if (IS_MOCK || !buildings.length) return NO_NAMES;
    const {data, error} = await supabase().from('buildings').select('id, name').in('id', buildings);
    if (error) throw error;
    return Object.fromEntries(data.map(({id, name}) => [id, name ?? id]));
  });
}

/** Course search by code. Real mode needs 2+ characters and returns at most 20 rows. */
export async function searchCourses(q: string): Promise<CourseHit[]> {
  // Keep LIKE wildcards and filter syntax out. "CS 577" is how the app abbreviates COMP SCI, so accept it back.
  const needle = q.trim().replace(/[%_,()]/g, '').replace(/^cs\s*(?=\d|$)/i, 'COMP SCI ').trim();
  if (IS_MOCK) return needle ? COURSES.filter((c) => c.code.toLowerCase().includes(needle.toLowerCase())).map(mockHit) : [];
  if (needle.length < 2) return [];
  const {data, error} = await supabase().from('courses').select('id, code, title, credit_options').ilike('code', `%${needle}%`).order('code').limit(20);
  if (error) throw error;
  return data as CourseHit[];
}

/** Catalog courses with exactly these codes. Codes the catalog does not know are simply absent. */
export async function findCoursesByCodes(codes: string[]): Promise<CourseHit[]> {
  const unique = [...new Set(codes)];
  if (IS_MOCK) return COURSES.filter((course) => unique.includes(course.code)).map(mockHit);
  const found: CourseHit[] = [];
  for (let start = 0; start < unique.length; start += 100) {
    const {data, error} = await supabase().from('courses').select('id, code, title, credit_options').in('code', unique.slice(start, start + 100));
    if (error) throw error;
    found.push(...(data as CourseHit[]));
  }
  return found;
}

/** Section bundles of one course in one term, with their meetings. Empty when the catalog has none. */
export async function getBundles(courseId: string, term: string): Promise<Bundle[]> {
  if (IS_MOCK) return term === CURRENT_TERM ? (COURSES.find((c) => c.id === courseId)?.bundles ?? []) : [];
  const db = supabase();
  const [bundles, meetings] = await Promise.all([
    db.from('section_bundles').select('bundle_id, section_label, instructors, instructor_score').eq('term', term).eq('course_id', courseId).order('bundle_id'),
    db.from('meetings').select('bundle_id, day, start_min, end_min, mode, building_id').eq('term', term).eq('course_id', courseId),
  ]);
  if (bundles.error) throw bundles.error;
  if (meetings.error) throw meetings.error;
  return bundles.data.map((b) => {
    const ms = (meetings.data as (Meeting & {bundle_id: string})[]).filter((m) => m.bundle_id === b.bundle_id).sort(byDayThenStart);
    return {
      bundle_id: b.bundle_id as string,
      label: b.section_label ?? b.bundle_id,
      instructors: b.instructors as string[],
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

const NO_LISTS: Record<string, Bundle[]> = {};
/** Every section of each listed course in one term, keyed by course id. */
export function useBundleLists(term: string | null, courseIds: string[]): Record<string, Bundle[]> {
  const unique = [...new Set(courseIds)].sort();
  return useRemote(`bundle-lists:${term}|${unique.join(',')}`, NO_LISTS, async () => {
    if (!term || !unique.length) return NO_LISTS;
    return Object.fromEntries(await Promise.all(unique.map(async (id) => [id, await getBundles(id, term)] as const)));
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
      label: b.bundle_id,
      instructors: [],
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
