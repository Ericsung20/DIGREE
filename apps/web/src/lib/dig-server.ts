// Server-only: reads the signed-in user's planned courses and the catalog, then builds the optimizer request.
import {randomUUID} from 'node:crypto';
import {GENERAL_ED_CODES, generalEducationTags, matchingRawBreadthCodes, type CourseDesignationRow} from './breadth';
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

/** Planned courses and explicit major flags. RLS limits this to the signed-in student. */
async function plannedCourseFlags(db: Db, term: string): Promise<{course_id: string; counts_toward_major: boolean}[]> {
  const {data, error} = await db.from('user_course_records').select('course_id, counts_toward_major').eq('term', term).eq('status', 'planned');
  if (error) throw error;
  return data as {course_id: string; counts_toward_major: boolean}[];
}

async function majorCourseCodes(db: Db, programId: string | null): Promise<Set<string>> {
  const codes = new Set<string>();
  if (!programId) return codes;
  for (let start = 0; ; start += 1000) {
    const {data, error} = await db.from('program_requirement_course_options')
      .select('course_code').eq('program_id', programId).order('course_code').range(start, start + 999);
    if (error) throw error;
    for (const row of data as {course_code: string | null}[]) if (row.course_code) codes.add(row.course_code.trim().replace(/\s+/g, ' ').toUpperCase());
    if (data.length < 1000) return codes;
  }
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

/** Up to 12 courses of one subject that run this term with an open or unknown seat status. */
async function subjectCourses(db: Db, term: string, subject: string): Promise<CatalogRows['courses']> {
  const {data, error} = await db.from('courses').select(`${COURSE_COLUMNS}, section_bundles!inner()`)
    .ilike('code', `${subject} %`).eq('section_bundles.term', term).neq('section_bundles.seat_status', 'full')
    .order('code').limit(12);
  if (error) throw error;
  return data;
}

const subjectOf = (code: string) => /^([A-Z &-]+) \d+[A-Z]?$/i.exec(code)?.[1];
const courseNumber = (code: string) => Number(/(\d+)[A-Z]?$/i.exec(code)?.[1] ?? 999);

/** Courses on the student's program requirement lists that run this term with seats, lowest numbers first. */
async function programCourses(db: Db, term: string, programId: string | null): Promise<CatalogRows['courses']> {
  const codes = [...await majorCourseCodes(db, programId)];
  const pages = await Promise.all(batches(codes, BATCH).map(async (batch) => {
    const {data, error} = await db.from('courses').select(`${COURSE_COLUMNS}, section_bundles!inner()`)
      .in('code', batch).eq('section_bundles.term', term).neq('section_bundles.seat_status', 'full').order('code');
    if (error) throw error;
    return data;
  }));
  return pages.flat().sort((a, b) => courseNumber(a.code) - courseNumber(b.code) || a.code.localeCompare(b.code));
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

async function allDesignationCourses(db: Db, term: string, preferred: string[]): Promise<CatalogRows['courses']> {
  const breadths = matchingRawBreadthCodes(preferred);
  const filters = preferred.flatMap((code) => {
    if (Object.hasOwn(GENERAL_ED_CODES, code)) return [`general_ed_code.ilike.*${GENERAL_ED_CODES[code]}*`];
    return code === 'ETHNIC' ? ['ethnic_studies_code.not.is.null'] : [];
  });
  if (breadths.length) filters.push(`breadth_codes.ov.{${breadths.join(',')}}`);
  if (!filters.length) return [];
  const fallback = () => breadths.length ? catalogBreadthFallback(db, term, breadths) : [];
  const designations = new Map<string, string[]>();
  for (let start = 0; ; start += PAGE) {
    const {data, error} = await db.from('course_designations').select('course_id, breadth_codes, general_ed_code, ethnic_studies_code')
      .eq('term', term).or(filters.join(',')).order('course_id').range(start, start + PAGE - 1);
    if (error && ['PGRST205', '42P01'].includes(error.code)) return fallback();
    if (error) throw error;
    for (const row of data) designations.set(row.course_id, [...row.breadth_codes, ...generalEducationTags(row)]);
    if (data.length < PAGE) break;
  }
  if (!designations.size) {
    const {data, error} = await db.from('course_designations').select('course_id').eq('term', term).limit(1);
    if (error) throw error;
    return data.length ? [] : fallback();
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
  const plannedFlags = await plannedCourseFlags(db, inputs.term);
  const plannedIds = plannedFlags.map((row) => row.course_id);
  const plannedSet = new Set(plannedIds);
  const explicitMajor = new Set(plannedFlags.filter((row) => row.counts_toward_major).map((row) => row.course_id));
  if (inputs.required.some((id) => !plannedSet.has(id))) return {error: 'Your must-take courses changed. Go back to your conditions and dig again.'};
  const required = new Set(inputs.required);
  const [catalog, history, profile] = await Promise.all([
    db.from('courses').select(COURSE_COLUMNS).in('id', plannedIds).order('code'),
    loadCourseHistory(db, term),
    db.from('academic_profiles').select('program_id, academic_programs(label)').maybeSingle()
      .overrideTypes<{program_id: string | null; academic_programs: {label: string} | null}, {merge: false}>(),
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
      const subject = subjectOf(code);
      return subject ? [subject] : [];
    }))].slice(0, 3) : [];
    const [preferredRows, ...extras] = await Promise.all([
      breadthCanHelp ? allDesignationCourses(db, term, preferred) : [],
      ...subjects.map((subject) => subjectCourses(db, term, subject)),
    ]);
    const unique = [...new Map([...extras.flat(), ...preferredRows].filter((course) => !plannedSet.has(course.id)).map((course) => [course.id, course])).values()];
    const extraRequisites = await loadRequisites(db, term, unique.map(course => course.id));
    for (const [id, row] of extraRequisites) aliases.set(id, row.course_aliases ?? []);
    const {accepted: eligible} = assess(unique, extraRequisites);
    courses.push(...(breadthCanHelp ? eligible : eligible.slice(0, Math.max(0, 20 - (courses.length - inputs.required.length)))));
  }
  if (!required.size) {
    // Nothing to build around: DIG picks every course. Start from the student's program requirements;
    // without a program, use the subjects of courses they have taken.
    const skip = new Set([...courses.map(({id}) => id), ...history.map((record) => record.course_id)]);
    let pool = (await programCourses(db, term, profile.data?.program_id ?? null)).filter((course) => !skip.has(course.id));
    if (!pool.length) {
      const subjects = [...new Set(history.flatMap((record) => {
        const subject = record.courses?.code ? subjectOf(record.courses.code) : undefined;
        return subject ? [subject] : [];
      }))].slice(0, 3);
      pool = (await Promise.all(subjects.map((subject) => subjectCourses(db, term, subject)))).flat().filter((course) => !skip.has(course.id));
    }
    const poolRequisites = await loadRequisites(db, term, pool.map((course) => course.id));
    for (const [id, row] of poolRequisites) aliases.set(id, row.course_aliases ?? []);
    courses.push(...assess(pool, poolRequisites).accepted.slice(0, Math.max(0, 20 - courses.length)));
  }
  const ids = courses.map(({id}) => id);
  if (ids.length === 0) return {error: required.size
    ? 'No planned courses can be used. Check their requisites or add courses.'
    : 'DIG found no courses to suggest for this term. Add a must-take course, pick a course designation, or set your academic program.'};
  if (inputs.preferredBreadths?.some((code) => code in GENERAL_ED_CODES || code === 'ETHNIC')) {
    const designationTags = new Map<string, string[]>();
    for (let start = 0; start < ids.length; start += 100) {
      const {data, error} = await db.from('course_designations')
        .select('course_id, general_ed_code, ethnic_studies_code').eq('term', term).in('course_id', ids.slice(start, start + 100));
      if (error) throw error;
      for (const row of data as CourseDesignationRow[]) designationTags.set(row.course_id, generalEducationTags(row));
    }
    for (const course of courses) {
      const tags = designationTags.get(course.id) ?? [];
      if (tags.length) course.breadth = [...new Set([...(course.breadth ?? []), ...tags])];
    }
  }
  if ((inputs.maxMajorCourses !== undefined && inputs.maxMajorCourses !== null) || inputs.balanceMajorCourses) {
    const majorCodes = await majorCourseCodes(db, profile.data?.program_id ?? null);
    if (!majorCodes.size && !explicitMajor.size) {
      if (inputs.maxMajorCourses !== undefined && inputs.maxMajorCourses !== null) return {error: 'Set your academic program or mark planned courses for your major before using the major-course limit.'};
      inputs.balanceMajorCourses = false;
    }
    for (const course of courses) {
      const codes = [course.code, ...(aliases.get(course.id) ?? [])].map((code) => code.trim().replace(/\s+/g, ' ').toUpperCase());
      course.is_major_course = explicitMajor.has(course.id) || codes.some((code) => majorCodes.has(code));
    }
    const mustTakeMajor = courses.filter((course) => required.has(course.id) && course.is_major_course).length;
    if (inputs.maxMajorCourses !== undefined && inputs.maxMajorCourses !== null && mustTakeMajor > inputs.maxMajorCourses) return {error: `${mustTakeMajor} must-take courses count toward your major. Raise the major-course limit.`};
  }

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
  const request = toGenerateRequest(inputs, rows, randomUUID());
  if (!request.courses.length) return {error: 'Every course DIG found meets online only. Allow online classes or add a must-take course.'};
  return request;
}
