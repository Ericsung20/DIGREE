// Server-only: reads the signed-in user's planned courses and the catalog, then builds the optimizer request.
import {randomUUID} from 'node:crypto';
import {parseDigInputs, toGenerateRequest, type CatalogRows, type DigDefaults, type GenerateRequest} from './dig-request';
import {supabaseServer} from './supabase-server';
import type {Term} from './data/catalog';

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
  const {data: courses, error: courseError} = ids.length ? await db.from('courses').select('id, code, credit_options').in('id', ids).order('code') : {data: [], error: null};
  if (courseError) throw courseError;
  const rows = (courses ?? []) as {id: string; code: string; credit_options: number[]}[];
  const credits = rows.reduce((sum, c) => sum + c.credit_options[0], 0);
  return {
    term: term.id,
    termLabel: term.label,
    terms: list.map(({id, label}) => ({id, label})),
    minCredits: Math.min(40, credits),
    maxCredits: Math.min(40, rows.reduce((sum, c) => sum + Math.max(...c.credit_options), 0)),
    earliest: 480,
    latest: 1140,
    courses: rows.map((c) => ({id: c.id, code: c.code, credits: c.credit_options.join('/'), required: true})),
    sample: false,
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
  const ids = await plannedCourseIds(db, inputs.term);
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
  if (inputs.required.some((id) => !ids.includes(id))) return {error: 'Your planned courses changed. Reopen DIG and try again.'};
  const [courses, bundles, meetings, stats, done] = await Promise.all([
    db.from('courses').select('id, code, credit_options, repeatable').in('id', ids).order('code'),
    perCourse<CatalogRows['bundles'][number]>('section_bundles', 'course_id, bundle_id, seat_status, instructor_score', 'bundle_id'),
    perCourse<CatalogRows['meetings'][number]>('meetings', 'course_id, bundle_id, day, start_min, end_min, mode, building_id', 'id'),
    db.from('course_grade_stats').select('course_id, a_ab_rate, sample_size').in('course_id', ids),
    db.from('user_course_records').select('course_id').eq('status', 'completed').in('course_id', ids),
  ]);
  for (const r of [courses, stats, done]) if (r.error) throw r.error;

  const rows: CatalogRows = {
    courses: courses.data as CatalogRows['courses'],
    bundles,
    meetings,
    stats: stats.data as CatalogRows['stats'],
    edges: await walkingEdges(db, meetings),
    completedCourseIds: (done.data as {course_id: string}[]).map((r) => r.course_id),
  };
  // A random id per request: nothing that identifies the user leaves this server.
  return toGenerateRequest(inputs, rows, randomUUID());
}
