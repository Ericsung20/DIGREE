// Server-only: reads the signed-in user's planned courses and the catalog, then builds the optimizer request.
import {randomUUID} from 'node:crypto';
import {parseDigInputs, toGenerateRequest, type CatalogRows, type GenerateRequest} from './dig-request';
import {evaluateRequisites, requisiteEvidence, type PriorAttempt} from './dig-prerequisites';
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

type RequisiteRow = {course_id: string; course_aliases: string[] | null; enrollment_requisites: string | null; requirement_groups: Record<string, number[]> | null};

async function loadCourseHistory(db: Db, term: string): Promise<PriorAttempt[]> {
  const history: PriorAttempt[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const {data, error} = await db.from('user_course_records')
      .select('course_id, term, status, courses(code), grade_entries(letter_grade), terms(is_current)')
      .lte('term', term).in('status', ['completed', 'enrolled_self_reported'])
      .order('id').range(start, start + pageSize - 1).overrideTypes<PriorAttempt[], {merge: false}>();
    if (error) throw error;
    history.push(...data);
    if (data.length < pageSize) return history;
  }
}

async function loadRequisites(db: Db, term: string, ids: string[]): Promise<Map<string, RequisiteRow>> {
  const rows = new Map<string, RequisiteRow>();
  for (let start = 0; start < ids.length; start += 150) {
    const {data, error} = await db.from('course_requisites')
      .select('course_id, course_aliases, enrollment_requisites, requirement_groups')
      .eq('term', term).in('course_id', ids.slice(start, start + 150)).overrideTypes<RequisiteRow[], {merge: false}>();
    if (error) throw error;
    for (const row of data) rows.set(row.course_id, row);
  }
  return rows;
}

/** Candidates are the user's planned courses for the term; the form decides which are required. */
export async function buildGenerateRequestFromDb(raw: unknown): Promise<GenerateRequest | {error: string}> {
  const inputs = parseDigInputs(raw);
  if ('error' in inputs) return inputs;
  const {term} = inputs;
  const db = await supabaseServer();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) return {error: 'Sign in to generate schedules.'};
  const plannedIds = await plannedCourseIds(db, inputs.term);
  if (plannedIds.length === 0) return {error: 'Add a must-take course for this term first.'};
  if (inputs.required.some((id) => !plannedIds.includes(id))) return {error: 'Your must-take courses changed. Go back to your conditions and dig again.'};
  const required = new Set(inputs.required);
  const [catalog, history, profile] = await Promise.all([
    db.from('courses').select('id, code, credit_options, repeatable, breadth').in('id', plannedIds).order('code'),
    loadCourseHistory(db, term),
    db.from('academic_profiles').select('academic_programs(label)').maybeSingle()
      .overrideTypes<{academic_programs: {label: string} | null}, {merge: false}>(),
  ]);
  if (catalog.error) throw catalog.error;
  if (profile.error) throw profile.error;
  const planned: CatalogRows['courses'] = catalog.data;
  const historyIds = [...new Set(history.map(record => record.course_id))];
  const requisiteRows = await loadRequisites(db, term, [...new Set([...plannedIds, ...historyIds])]);
  const aliases = new Map([...requisiteRows].map(([id, row]) => [id, row.course_aliases ?? []]));
  // Use the publication for each actual attempt as well, since the subject listing can change by term.
  for (const priorTerm of new Set(history.map(record => record.term).filter(attemptTerm => attemptTerm !== term))) {
    const priorRows = await loadRequisites(db, priorTerm, history.filter(record => record.term === priorTerm).map(record => record.course_id));
    for (const [id, row] of priorRows) aliases.set(id, [...new Set([...(aliases.get(id) ?? []), ...(row.course_aliases ?? [])])]);
  }
  const program = profile.data?.academic_programs?.label ?? '';
  const undergraduate = /(?:,\s*|\s)(?:BA|BS[A-Z]*|BBA|BFA|BM|BNS|BLA|Bachelor)(?=\b)/i.test(program);
  const evidence = requisiteEvidence(history, term, aliases, planned.filter(course => required.has(course.id)), undergraduate);
  function assess(candidates: CatalogRows['courses'], rows: ReadonlyMap<string, RequisiteRow>) {
    const accepted: CatalogRows['courses'] = [];
    const blocked: string[] = [];
    for (const course of candidates) {
      const rule = rows.get(course.id);
      // A course cannot meet its own concurrent requirement using its planned selection.
      const ownCodes = new Set([course.code, ...(aliases.get(course.id) ?? [])].map(item => item.trim().replace(/\s+/g, ' ').toUpperCase()));
      const concurrent = new Set([...evidence.concurrent].filter(item => !ownCodes.has(item)));
      const status = evaluateRequisites(rule?.enrollment_requisites, {...evidence, concurrent});
      if (status === 'unmet') {
        if (required.has(course.id)) {
          blocked.push(course.code + ' has an unmet enrollment requisite. ' + rule?.enrollment_requisites);
        }
        continue;
      }
      const sectionReview = Object.keys(rule?.requirement_groups ?? {}).some(key => !!key.split('=')[1]);
      const review = status === 'review' || sectionReview;
      if (review && course.id.startsWith('uw-') && !required.has(course.id)) continue;
      accepted.push({...course, eligibility: status === 'met' && !sectionReview ? 'eligible' : 'unknown'});
    }
    return {accepted, blocked};
  }
  const {accepted: courses, blocked} = assess(planned, requisiteRows);
  if (blocked.length) return {error: blocked.join(' ')};
  const availableCredits = courses.reduce((total, course) => total + Math.max(...course.credit_options), 0);
  if ((inputs.related || inputs.preferredBreadths?.length) && availableCredits < inputs.minCredits) {
    const preferred = inputs.preferredBreadths ?? [];
    const breadthExtras = preferred.length ? await db.from('courses')
      .select('id, code, credit_options, repeatable, breadth, section_bundles!inner(term)')
      .overlaps('breadth', preferred).eq('section_bundles.term', inputs.term).neq('section_bundles.seat_status', 'full')
      .order('code').limit(20) : null;
    if (breadthExtras?.error) throw breadthExtras.error;
    const subjects = inputs.related ? [...new Set(courses.flatMap(({code}) => {
      const subject = /^([A-Z &-]+) \d+[A-Z]?$/i.exec(code)?.[1];
      return subject ? [subject] : [];
    }))].slice(0, 3) : [];
    const extras = await Promise.all(subjects.map(async (subject) => {
      const {data, error} = await db.from('courses').select('id, code, credit_options, repeatable, breadth, section_bundles!inner(term)')
        .ilike('code', `${subject} %`).eq('section_bundles.term', inputs.term).neq('section_bundles.seat_status', 'full')
        .order('code').limit(12);
      if (error) throw error;
      return data.map(({id, code, credit_options, repeatable, breadth}) => ({id, code, credit_options, repeatable, breadth}));
    }));
    const preferredRows = (breadthExtras?.data ?? []).map(({id, code, credit_options, repeatable, breadth}) => ({id, code, credit_options, repeatable, breadth}));
    const unique = [...new Map([...preferredRows, ...extras.flat()].filter((course) => !plannedIds.includes(course.id)).map((course) => [course.id, course])).values()];
    const extraRequisites = await loadRequisites(db, term, unique.map(course => course.id));
    const {accepted: eligible} = assess(unique, extraRequisites);
    courses.push(...eligible.slice(0, Math.max(0, 20 - (courses.length - inputs.required.length))));
  }
  const ids = courses.map(({id}) => id);
  if (ids.length === 0) return {error: 'No planned courses can be used. Check their requisites or add courses.'};

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
  const [bundles, meetings, stats] = await Promise.all([
    perCourse<CatalogRows['bundles'][number]>('section_bundles', 'course_id, bundle_id, seat_status, instructor_score', 'bundle_id'),
    perCourse<CatalogRows['meetings'][number]>('meetings', 'course_id, bundle_id, day, start_min, end_min, mode, building_id', 'id'),
    db.from('course_grade_stats').select('course_id, a_ab_rate, sample_size').in('course_id', ids),
  ]);
  if (stats.error) throw stats.error;

  const rows: CatalogRows = {
    courses,
    bundles,
    meetings,
    stats: stats.data as CatalogRows['stats'],
    edges: await walkingEdges(db, meetings),
    completedCourseIds: history.filter(record => record.status === 'completed' && record.grade_entries?.letter_grade !== 'F')
      .map(record => record.course_id),
  };
  // A random id per request: nothing that identifies the user leaves this server.
  return toGenerateRequest(inputs, rows, randomUUID());
}
