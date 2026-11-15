// Server-only: reads the signed-in user's planned courses and the catalog, then builds the optimizer request.
import {randomUUID} from 'node:crypto';
import {parseDigInputs, toGenerateRequest, type CatalogRows, type GenerateRequest} from './dig-request';
import {evaluateRequisites, requisiteEvidence, type PriorAttempt} from './dig-prerequisites';
import {supabaseServer} from './supabase-server';

type Db = Awaited<ReturnType<typeof supabaseServer>>;
const COURSE_COLUMNS = 'id, code, credit_options, repeatable, breadth';
const BATCH = 100;
const PAGE = 750;

function batches<T>(items: T[], size: number): T[][] {
  return Array.from({length: Math.ceil(items.length / size)}, (_, index) => items.slice(index * size, (index + 1) * size));
}

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
  const selected = new Set(buildings);
  for (const batch of batches(buildings, BATCH)) {
    for (let start = 0; ; start += PAGE) {
      const {data, error} = await db.from('walking_edges')
        .select('from_building_id, to_building_id, minutes, bidirectional')
        .in('from_building_id', batch)
        .order('from_building_id').order('to_building_id').range(start, start + PAGE - 1);
      if (error) throw error;
      edges.push(...data.filter((edge) => selected.has(edge.to_building_id)));
      if (data.length < PAGE) break;
    }
  }
  return edges;
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

async function catalogBreadthFallback(db: Db, term: string, breadths: string[]): Promise<CatalogRows['courses']> {
  const courses: CatalogRows['courses'] = [];
  for (let start = 0; ; start += PAGE) {
    const {data, error} = await db.from('courses')
      .select(`${COURSE_COLUMNS}, section_bundles!inner()`)
      .overlaps('breadth', breadths).eq('section_bundles.term', term)
      .order('id').range(start, start + PAGE - 1);
    if (error) throw error;
    courses.push(...data);
    if (data.length < PAGE) return courses;
  }
}

async function allBreadthCourses(db: Db, term: string, breadths: string[]): Promise<CatalogRows['courses']> {
  const designations = new Map<string, string[]>();
  for (let start = 0; ; start += PAGE) {
    const {data, error} = await db.from('course_designations').select('course_id, breadth_codes')
      .eq('term', term).overlaps('breadth_codes', breadths).order('course_id').range(start, start + PAGE - 1);
    if (error && ['PGRST205', '42P01'].includes(error.code)) return catalogBreadthFallback(db, term, breadths);
    if (error) throw error;
    for (const row of data) designations.set(row.course_id, row.breadth_codes);
    if (data.length < PAGE) break;
  }
  if (!designations.size) {
    const {data, error} = await db.from('course_designations').select('course_id').eq('term', term).limit(1);
    if (error) throw error;
    return data.length ? [] : catalogBreadthFallback(db, term, breadths);
  }
  const pages = await Promise.all(batches([...designations.keys()], BATCH).map(async (batch) => {
    const {data, error} = await db.from('courses').select(`${COURSE_COLUMNS}, section_bundles!inner()`)
      .in('id', batch).eq('section_bundles.term', term).order('id');
    if (error) throw error;
    return data.map((course) => ({...course, breadth: designations.get(course.id)!}));
  }));
  return pages.flat();
}

/** Resolve planned courses and optional catalog candidates for the selected term. */
export async function buildGenerateRequestFromDb(raw: unknown): Promise<GenerateRequest | {error: string}> {
  const inputs = parseDigInputs(raw);
  if ('error' in inputs) return inputs;
  const {term} = inputs;
  const db = await supabaseServer();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) return {error: 'Sign in to generate schedules.'};
  const plannedIds = await plannedCourseIds(db, inputs.term);
  const plannedSet = new Set(plannedIds);
  if (plannedIds.length === 0) return {error: 'Add a must-take course for this term first.'};
  if (inputs.required.some((id) => !plannedSet.has(id))) return {error: 'Your must-take courses changed. Go back to your conditions and dig again.'};
  const required = new Set(inputs.required);
  const [catalog, history, profile] = await Promise.all([
    db.from('courses').select(COURSE_COLUMNS).in('id', plannedIds).order('code'),
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
      const ownCodes = new Set([course.code, ...(rule?.course_aliases ?? [])].map(item => item.trim().replace(/\s+/g, ' ').toUpperCase()));
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
  const preferred = inputs.preferredBreadths ?? [];
  const availableCredits = courses.reduce((total, course) => total + Math.max(...course.credit_options), 0);
  // Match the optimizer's credit policy, including variable-credit required courses.
  let requiredTotals = new Set([0]);
  for (const course of courses.filter(({id}) => required.has(id))) {
    requiredTotals = new Set([...requiredTotals].flatMap((total) => course.credit_options
      .map((credits) => total + credits).filter((total) => total <= inputs.maxCredits)));
  }
  const breadthCanHelp = preferred.length > 0 && [...requiredTotals].some((total) => total < inputs.maxCredits)
    && ![...requiredTotals].some((total) => total >= inputs.minCredits && total > 0);
  const relatedCanHelp = inputs.related && availableCredits < inputs.minCredits;
  if (breadthCanHelp || relatedCanHelp) {
    const subjects = relatedCanHelp ? [...new Set(courses.flatMap(({code}) => {
      const subject = /^([A-Z &-]+) \d+[A-Z]?$/i.exec(code)?.[1];
      return subject ? [subject] : [];
    }))].slice(0, 3) : [];
    const [preferredRows, ...extras] = await Promise.all([
      breadthCanHelp ? allBreadthCourses(db, term, preferred) : [],
      ...subjects.map(async (subject) => {
        const {data, error} = await db.from('courses').select(`${COURSE_COLUMNS}, section_bundles!inner()`)
          .ilike('code', `${subject} %`).eq('section_bundles.term', inputs.term).neq('section_bundles.seat_status', 'full')
          .order('code').limit(12);
        if (error) throw error;
        return data;
      }),
    ]);
    const unique = [...new Map([...extras.flat(), ...preferredRows].filter((course) => !plannedSet.has(course.id)).map((course) => [course.id, course])).values()];
    const extraRequisites = await loadRequisites(db, term, unique.map(course => course.id));
    const {accepted: eligible} = assess(unique, extraRequisites);
    courses.push(...(breadthCanHelp ? eligible : eligible.slice(0, Math.max(0, 20 - (courses.length - inputs.required.length)))));
  }
  const ids = courses.map(({id}) => id);
  if (ids.length === 0) return {error: 'No planned courses can be used. Check their requisites or add courses.'};

  const courseBatches = batches(ids, BATCH);
  const readSections = async <T,>(table: 'section_bundles' | 'meetings', columns: string, sortBy: string): Promise<T[]> => {
    const rows: T[] = [];
    for (const batch of courseBatches) {
      for (let start = 0; ; start += PAGE) {
        const {data, error} = await db.from(table).select(columns).eq('term', term).in('course_id', batch)
          .order('course_id').order(sortBy).range(start, start + PAGE - 1);
        if (error) throw error;
        rows.push(...(data as unknown as T[]));
        if (data.length < PAGE) break;
      }
    }
    return rows;
  };
  const [bundles, meetings, stats] = await Promise.all([
    readSections<CatalogRows['bundles'][number]>('section_bundles', 'course_id, bundle_id, seat_status, instructor_score', 'bundle_id'),
    readSections<CatalogRows['meetings'][number]>('meetings', 'course_id, bundle_id, day, start_min, end_min, mode, building_id', 'id'),
    Promise.all(courseBatches.map(async (batch) => {
      const {data, error} = await db.from('course_grade_stats').select('course_id, a_ab_rate, sample_size').in('course_id', batch);
      if (error) throw error;
      return data;
    })),
  ]);
  // Users may explicitly plan a full section, but DIG should not auto-add one.
  const availableBundles = breadthCanHelp ? bundles.filter((bundle) => plannedSet.has(bundle.course_id) || bundle.seat_status !== 'full') : bundles;

  const rows: CatalogRows = {
    courses,
    bundles: availableBundles,
    meetings,
    stats: stats.flat() as CatalogRows['stats'],
    edges: await walkingEdges(db, meetings),
    completedCourseIds: history.filter(record => record.status === 'completed' && record.grade_entries?.letter_grade !== 'F')
      .map(record => record.course_id),
  };
  // A random id per request: nothing that identifies the user leaves this server.
  return toGenerateRequest(inputs, rows, randomUUID());
}
