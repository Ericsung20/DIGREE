// Server-only: reads the signed-in user's planned courses and the catalog, then builds the optimizer request.
import {randomUUID} from 'node:crypto';
import {parseDigInputs, toGenerateRequest, type CatalogRows, type DigDefaults, type GenerateRequest} from './dig-request';
import {CS400_PREREQUISITE, hasPriorPrerequisite, type PriorAttempt} from './dig-prerequisites';
import {supabaseServer} from './supabase-server';
import type {Term} from './data/catalog';
import {displayTerm} from './terms';

type Db = Awaited<ReturnType<typeof supabaseServer>>;

/** Course ids the user has marked as planned for a term. RLS limits this to their own rows. */
async function plannedCourseIds(db: Db, term: string): Promise<string[]> {
  const {data, error} = await db.from('user_course_records').select('course_id').eq('term', term).eq('status', 'planned');
  if (error) throw error;
  return (data as {course_id: string}[]).map((r) => r.course_id);
}

/** Form defaults for the DIG screen, or null when nobody is signed in or no term exists. */
export async function getDigDefaults(selectedTerm?: string): Promise<DigDefaults | 'no-terms' | null> {
  const db = await supabaseServer();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) return null;
  const {data: terms, error} = await db.from('terms').select('id, label, is_current').order('id');
  if (error) throw error;
  const list = terms as Term[];
  const planned = await db.from('user_course_records').select('term').eq('status', 'planned').order('term', {ascending: false}).limit(1).maybeSingle();
  if (planned.error) throw planned.error;
  const term = list.find((t) => t.id === selectedTerm) ?? list.find((t) => t.id === planned.data?.term) ?? list.at(-1);
  if (!term) return 'no-terms';
  const ids = await plannedCourseIds(db, term.id);
  const [{data: courses, error: courseError}, available] = await Promise.all([
    ids.length ? db.from('courses').select('id, code, credit_options').in('id', ids).order('code') : {data: [], error: null},
    db.from('section_bundles').select('term').eq('term', term.id).limit(1),
  ]);
  if (courseError) throw courseError;
  if (available.error) throw available.error;
  const rows = (courses ?? []) as {id: string; code: string; credit_options: number[]}[];
  const credits = rows.reduce((sum, c) => sum + c.credit_options[0], 0);
  return {
    term: term.id,
    termLabel: displayTerm(term.label),
    terms: list.map(({id, label}) => ({id, label: displayTerm(label)})),
    minCredits: Math.min(40, credits),
    maxCredits: Math.min(40, rows.reduce((sum, c) => sum + Math.max(...c.credit_options), 0)),
    earliest: 480,
    latest: 1140,
    courses: rows.map((c) => ({id: c.id, code: c.code, credits: c.credit_options.join('/'), required: true})),
    sample: false,
    hasSections: available.data.length > 0,
  };
}

async function walkingEdges(db: Db, meetings: CatalogRows['meetings']): Promise<CatalogRows['edges']> {
  const buildings = [...new Set(meetings.flatMap((m) => m.mode !== 'online_sync' && m.building_id ? [m.building_id] : []))];
  if (buildings.length < 2) return [];
  const edges: CatalogRows['edges'] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const {data, error} = await db.from('walking_edges')
      .select('from_building_id, to_building_id, minutes, bidirectional')
      .in('from_building_id', buildings).in('to_building_id', buildings)
      .order('from_building_id').order('to_building_id').range(start, start + pageSize - 1);
    if (error) throw error;
    edges.push(...data);
    if (data.length < pageSize) return edges;
  }
}

/** Candidates are the user's planned courses for the term; the form decides which are required. */
export async function buildGenerateRequestFromDb(raw: unknown): Promise<GenerateRequest | {error: string}> {
  const inputs = parseDigInputs(raw);
  if ('error' in inputs) return inputs;
  const db = await supabaseServer();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) return {error: 'Sign in to generate schedules.'};
  const plannedIds = await plannedCourseIds(db, inputs.term);
  if (plannedIds.length === 0) return {error: 'Add planned courses for this term first.'};
  if (inputs.required.some((id) => !plannedIds.includes(id))) return {error: 'Your planned courses changed. Reopen DIG and try again.'};
  if (CS400_PREREQUISITE.terms.has(inputs.term) && inputs.required.includes(CS400_PREREQUISITE.courseId)) {
    const {data: history, error} = await db.from('user_course_records')
      .select('term, status, grade_entries(letter_grade), terms(is_current)')
      .eq('course_id', CS400_PREREQUISITE.prerequisiteId)
      .lt('term', inputs.term).in('status', ['completed', 'enrolled_self_reported'])
      .overrideTypes<PriorAttempt[], {merge: false}>();
    if (error) throw error;
    if (!hasPriorPrerequisite(history, inputs.term)) {
      return {error: CS400_PREREQUISITE.message};
    }
  }
  const catalog = await db.from('courses').select('id, code, credit_options, repeatable').in('id', plannedIds).order('code');
  if (catalog.error) throw catalog.error;
  const courses: CatalogRows['courses'] = catalog.data;
  const availableCredits = courses.reduce((total, course) => total + Math.max(...course.credit_options), 0);
  if (inputs.related && availableCredits < inputs.minCredits) {
    const subjects = [...new Set(courses.flatMap(({code}) => {
      const subject = /^([A-Z &-]+) \d+[A-Z]?$/i.exec(code)?.[1];
      return subject ? [subject] : [];
    }))].slice(0, 3);
    const extras = await Promise.all(subjects.map(async (subject) => {
      const {data, error} = await db.from('courses').select('id, code, credit_options, repeatable, section_bundles!inner(term)')
        .ilike('code', `${subject} %`).eq('section_bundles.term', inputs.term).neq('section_bundles.seat_status', 'full')
        .order('code').limit(12);
      if (error) throw error;
      return data.map(({id, code, credit_options, repeatable}) => ({id, code, credit_options, repeatable}));
    }));
    const unique = [...new Map(extras.flat().filter((course) => !plannedIds.includes(course.id)).map((course) => [course.id, course])).values()];
    courses.push(...unique.slice(0, Math.max(0, 20 - (courses.length - inputs.required.length))));
  }
  const ids = courses.map(({id}) => id);
  if (ids.length === 0) return {error: 'Add planned courses for this term first.'};

  const perCourse = async <T,>(table: string, columns: string, sortBy: string): Promise<T[]> => {
    const pages = await Promise.all(ids.map(async (id) => {
      const rows: T[] = [];
      const size = 1000;
      for (let start = 0; ; start += size) {
        const {data, error} = await db.from(table).select(columns).eq('term', inputs.term).eq('course_id', id)
          .order(sortBy).range(start, start + size - 1);
        if (error) throw error;
        rows.push(...(data as T[]));
        if (data.length < size) return rows;
      }
    }));
    return pages.flat();
  };
  const [bundles, meetings, stats, done] = await Promise.all([
    perCourse<CatalogRows['bundles'][number]>('section_bundles', 'course_id, bundle_id, seat_status, instructor_score', 'bundle_id'),
    perCourse<CatalogRows['meetings'][number]>('meetings', 'course_id, bundle_id, day, start_min, end_min, mode, building_id', 'id'),
    db.from('course_grade_stats').select('course_id, a_ab_rate, sample_size').in('course_id', ids),
    db.from('user_course_records').select('course_id').eq('status', 'completed').in('course_id', ids),
  ]);
  for (const r of [stats, done]) if (r.error) throw r.error;

  const rows: CatalogRows = {
    courses,
    bundles,
    meetings,
    stats: stats.data as CatalogRows['stats'],
    edges: await walkingEdges(db, meetings),
    completedCourseIds: (done.data as {course_id: string}[]).map((r) => r.course_id),
  };
  // A random id per request: nothing that identifies the user leaves this server.
  return toGenerateRequest(inputs, rows, randomUUID());
}
