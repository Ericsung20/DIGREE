// Server-only: reads the signed-in user's planned courses and the catalog, then builds the optimizer request.
import {randomUUID} from 'node:crypto';
import {parseDigInputs, toGenerateRequest, type CatalogRows, type GenerateRequest} from './dig-request';
import {supabaseServer} from './supabase-server';

type Db = Awaited<ReturnType<typeof supabaseServer>>;

/** Course ids the user has marked as planned for a term. RLS limits this to their own rows. */
async function plannedCourseIds(db: Db, term: string): Promise<string[]> {
  const {data, error} = await db.from('user_course_records').select('course_id').eq('term', term).eq('status', 'planned');
  if (error) throw error;
  return (data as {course_id: string}[]).map((r) => r.course_id);
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
  if (plannedIds.length === 0) return {error: 'Add a must-take course for this term first.'};
  if (inputs.required.some((id) => !plannedIds.includes(id))) return {error: 'Your must-take courses changed. Go back to your conditions and dig again.'};
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
  if (ids.length === 0) return {error: 'Add a must-take course for this term first.'};

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
