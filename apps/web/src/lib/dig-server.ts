// Server-only: reads the signed-in user's planned courses and the catalog, then builds the optimizer request.
import {randomUUID} from 'node:crypto';
import {GENERAL_ED_CODES, generalEducationTags, matchingRawBreadthCodes, type CourseDesignationRow} from './breadth';
import {compatibleSections, graduateLevel, graduateProgram, knownEasy, pickCandidates, relevance, sectionFits, type Candidate, type TimeWindow} from './dig-candidates';
import {parseDigInputs, toGenerateRequest, type CatalogRows, type GenerateRequest} from './dig-request';
import {evaluateRequisites, requisiteEvidence, type PriorAttempt, type RecognizedTransfer} from './dig-prerequisites';
import {supabaseServer} from './supabase-server';
import {majorCourseRules, type MajorOption} from './major-courses';

type Db = Awaited<ReturnType<typeof supabaseServer>>;
const COURSE_COLUMNS = 'id, code, credit_options, repeatable, breadth';
const BATCH = 100;
/**
 * Most optional courses DIG sends. The optimizer searches all of them (catalog search) within its step
 * budget; the cap only keeps the request to a few megabytes.
 */
const OPTIONAL_LIMIT = 250;
/** Weight of requirement fit (program requirement, picked designation, related subject) in the ranking. */
const DEGREE_FIT_WEIGHT = 0.6;
/** Weight of courses students know as easy (dig-candidates `KNOWN_EASY`), on top of their grade data. */
const KNOWN_EASY_WEIGHT = 0.6;
const PARALLEL = 8;
const PAGE = 750;

function batches<T>(items: T[], size: number): T[][] {
  return Array.from({length: Math.ceil(items.length / size)}, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function termCourseRows(db: Db, term: string, courses: CatalogRows['courses']): Promise<CatalogRows['courses']> {
  const snapshots = new Map<string, {credit_options: number[]; breadth: string[] | null; repeatable: boolean}>();
  const pages = await inParallel(batches(courses.map(course => course.id), BATCH), async batch => {
    const {data, error} = await db.from('course_offerings').select('course_id, credit_options, breadth, repeatable').eq('term', term).in('course_id', batch);
    if (error) throw error;
    return data;
  });
  for (const row of pages.flat()) snapshots.set(row.course_id, row);
  return courses.map(course => {
    const snapshot = snapshots.get(course.id);
    return snapshot ? {...course, ...snapshot, breadth: course.breadth?.some(tag => tag.startsWith('COMM_') || tag.startsWith('QR_') || tag === 'ETHNIC') ? course.breadth : snapshot.breadth} : course;
  });
}

/** Planned courses and explicit major flags. RLS limits this to the signed-in student. */
async function plannedCourseFlags(db: Db, term: string): Promise<{course_id: string; counts_toward_major: boolean}[]> {
  const {data, error} = await db.from('planner_courses').select('course_id, counts_toward_major').eq('term', term);
  if (error) throw error;
  return data as {course_id: string; counts_toward_major: boolean}[];
}

async function loadMajorRules(db: Db, programIds: string[]): Promise<Map<string, string[]>> {
  const options: MajorOption[] = [];
  if (!programIds.length) return new Map();
  for (let start = 0; ; start += 1000) {
    const {data, error} = await db.from('program_requirement_course_options')
      .select('course_code, requirement_group, program').in('program_id', programIds).order('course_code').range(start, start + 999);
    if (error) throw error;
    options.push(...data as MajorOption[]);
    if (data.length < 1000) return majorCourseRules(options);
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

const subjectOf = (code: string) => /^([A-Z &-]+) \d+[A-Z]?$/i.exec(code)?.[1];

/** Runs `work` over `items` at most PARALLEL at a time, keeping their order. */
async function inParallel<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += PARALLEL) out.push(...await Promise.all(items.slice(start, start + PARALLEL).map(work)));
  return out;
}

/**
 * Every row of a term's sections or meetings. The first page shows how many rows the API returns
 * per request; the remaining pages are then read in parallel.
 */
async function wholeTerm<T>(db: Db, table: 'section_bundles' | 'meetings', columns: string, term: string): Promise<T[]> {
  const page = (start: number, size: number) => db.from(table).select(columns, start === 0 ? {count: 'exact'} : {})
    .eq('term', term).order('course_id').order('bundle_id').order(table === 'meetings' ? 'id' : 'course_id').range(start, start + size - 1);
  const first = await page(0, 1000);
  if (first.error) throw first.error;
  const rows = first.data as unknown as T[];
  const total = first.count ?? rows.length;
  const size = rows.length;
  if (!size || rows.length >= total) return rows;
  const starts = Array.from({length: Math.ceil((total - size) / size)}, (_, i) => size + i * size);
  const pages = await inParallel(starts, async (start) => {
    const {data, error} = await page(start, size);
    if (error) throw error;
    return data as unknown as T[];
  });
  return [...rows, ...pages.flat()];
}

type RequisiteRow = {course_id: string; course_aliases: string[] | null; enrollment_requisites: string | null; requirement_groups: Record<string, number[]> | null};

async function loadCourseHistory(db: Db, term: string): Promise<PriorAttempt[]> {
  const history: PriorAttempt[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const {data, error} = await db.from('course_attempts')
      .select('course_id, term, status, courses(code), grade_entries(letter_grade), terms(is_current)')
      .lte('term', term).in('status', ['completed', 'enrolled_self_reported'])
      .order('id').range(start, start + pageSize - 1).overrideTypes<PriorAttempt[], {merge: false}>();
    if (error) throw error;
    history.push(...data);
    if (data.length < pageSize) return history;
  }
}

async function loadRequisites(db: Db, term: string, ids: string[]): Promise<Map<string, RequisiteRow>> {
  const pages = await inParallel(batches(ids, 150), async (batch) => {
    const {data, error} = await db.from('course_requisites')
      .select('course_id, course_aliases, enrollment_requisites, requirement_groups')
      .eq('term', term).in('course_id', batch).overrideTypes<RequisiteRow[], {merge: false}>();
    if (error) throw error;
    return data;
  });
  return new Map(pages.flat().map((row) => [row.course_id, row]));
}

async function loadAliases(db: Db, ids: string[], aliases: Map<string, string[]>): Promise<void> {
  const pages = await inParallel(batches(ids, BATCH), async batch => {
    const {data, error} = await db.from('course_aliases').select('course_id, code').in('course_id', batch);
    if (error) throw error;
    return data;
  });
  for (const row of pages.flat()) aliases.set(row.course_id, [...new Set([...(aliases.get(row.course_id) ?? []), row.code])]);
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
export async function buildGenerateContextFromDb(raw: unknown): Promise<{request: GenerateRequest; majorCourses: Record<string, string[]>} | {error: string}> {
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
  const [catalog, history, profiles, transferResult] = await Promise.all([
    db.from('courses').select(COURSE_COLUMNS).in('id', plannedIds).order('code'),
    loadCourseHistory(db, term),
    db.from('student_programs').select('program_id, kind, is_primary, name'),
    db.from('transfer_credits').select('equivalent_course_id, awarded_term, courses(code)').lte('awarded_term', term),
  ]);
  if (catalog.error) throw catalog.error;
  if (profiles.error) throw profiles.error;
  if (transferResult.error) throw transferResult.error;
  const transfers = (transferResult.data ?? []) as unknown as RecognizedTransfer[];
  const planned = await termCourseRows(db, term, catalog.data);
  const historyIds = [...new Set([...history.map(record => record.course_id), ...transfers.flatMap(row => row.equivalent_course_id ? [row.equivalent_course_id] : [])])];
  const requisiteRows = await loadRequisites(db, term, [...new Set([...plannedIds, ...historyIds])]);
  const aliases = new Map([...requisiteRows].map(([id, row]) => [id, row.course_aliases ?? []]));
  await loadAliases(db, [...new Set([...plannedIds, ...historyIds])], aliases);
  // Use the publication for each actual attempt as well, since the subject listing can change by term.
  for (const priorTerm of new Set(history.map(record => record.term).filter(attemptTerm => attemptTerm !== term))) {
    const priorRows = await loadRequisites(db, priorTerm, history.filter(record => record.term === priorTerm).map(record => record.course_id));
    for (const [id, row] of priorRows) aliases.set(id, [...new Set([...(aliases.get(id) ?? []), ...(row.course_aliases ?? [])])]);
  }
  const programs = (profiles.data ?? []) as {program_id: string | null; kind: string; is_primary: boolean; name: string}[];
  const majorRules = await loadMajorRules(db, programs.flatMap(item => item.kind === 'major' && item.program_id ? [item.program_id] : []));
  const program = programs.find(item => item.is_primary)?.name ?? '';
  const undergraduate = /(?:,\s*|\s)(?:BA|BS[A-Z]*|BBA|BFA|BM|BNS|BLA|Bachelor)(?=\b)/i.test(program);
  const evidence = requisiteEvidence(history, term, aliases, planned.filter(course => required.has(course.id)), undergraduate, transfers);
  function assess(candidates: CatalogRows['courses'], rows: ReadonlyMap<string, RequisiteRow>, keepReview = false) {
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
      if (review && course.id.startsWith('uw-') && !required.has(course.id) && !keepReview) continue;
      accepted.push({...course, eligibility: status === 'met' && !sectionReview ? 'eligible' : 'unknown'});
    }
    return {accepted, blocked};
  }
  const {accepted: courses, blocked} = assess(planned, requisiteRows);
  if (blocked.length) return {error: blocked.join(' ')};
  const preferred = inputs.preferredBreadths ?? [];
  // Match the optimizer's credit policy, including variable-credit required courses.
  let requiredTotals = new Set([0]);
  for (const course of courses.filter(({id}) => required.has(id))) {
    requiredTotals = new Set([...requiredTotals].flatMap((total) => course.credit_options
      .map((credits) => total + credits).filter((total) => total <= inputs.maxCredits)));
  }
  // Optional courses join only when the must-takes cannot reach the credit range alone (the optimizer's rule too).
  const optionalNeeded = [...requiredTotals].some((total) => total < inputs.maxCredits)
    && ![...requiredTotals].some((total) => total >= inputs.minCredits && total > 0);
  // Read once for the whole term when DIG picks courses, then reused for the request.
  let termSections: Pick<CatalogRows, 'bundles' | 'meetings'> | null = null;
  // By optional course: the sections DIG may use, because they fit the conditions and the must-takes.
  const usable = new Map<string, Set<string>>();
  let catalogPool = false;
  if (optionalNeeded) {
    const started = Date.now();
    const [termBundles, termMeetings, designated] = await Promise.all([
      wholeTerm<CatalogRows['bundles'][number]>(db, 'section_bundles', 'course_id, bundle_id, seat_status, instructor_score', term),
      wholeTerm<CatalogRows['meetings'][number]>(db, 'meetings', 'course_id, bundle_id, day, start_min, end_min, mode, building_id', term),
      preferred.length ? allDesignationCourses(db, term, preferred) : [],
    ]);
    termSections = {bundles: termBundles, meetings: termMeetings};

    // 1. Sections that keep to the hours, days and online choice, have seats, and leave room for every must-take.
    const window: TimeWindow = {earliest: inputs.earliest, latest: inputs.latest, blockedDays: inputs.blockedDays, online: inputs.online !== false};
    const meetingsOf = new Map<string, CatalogRows['meetings']>();
    for (const meeting of termMeetings) {
      const key = `${meeting.course_id}|${meeting.bundle_id}`;
      const list = meetingsOf.get(key);
      if (list) list.push(meeting);
      else meetingsOf.set(key, [meeting]);
    }
    const sectionsOf = new Map<string, {bundle_id: string; seat_status: string; meetings: CatalogRows['meetings']}[]>();
    for (const bundle of termBundles) {
      const section = {bundle_id: bundle.bundle_id, seat_status: bundle.seat_status, meetings: meetingsOf.get(`${bundle.course_id}|${bundle.bundle_id}`) ?? []};
      const list = sectionsOf.get(bundle.course_id);
      if (list) list.push(section);
      else sectionsOf.set(bundle.course_id, [section]);
    }
    // A must-take keeps its online sections whatever the switch says.
    const mustTakes = [...required].map((id) => (sectionsOf.get(id) ?? []).map((section) => section.meetings).filter((meetings) => sectionFits(meetings, {...window, online: true})));
    const done = new Set([
      ...history.filter((record) => record.status === 'completed' && record.grade_entries?.letter_grade !== 'F').map((record) => record.course_id),
      ...transfers.flatMap(row => row.equivalent_course_id ? [row.equivalent_course_id] : []),
    ]);
    for (const [courseId, sections] of sectionsOf) {
      if (plannedSet.has(courseId)) continue;
      const fit = compatibleSections(sections.filter((section) => section.seat_status !== 'full'), mustTakes, window);
      if (fit.length) usable.set(courseId, new Set(fit.map((section) => section.bundle_id)));
    }

    // 2. Courses the student can take: requisites met or not yet decidable; unmet ones are dropped.
    const ids = [...usable.keys()];
    const [coursePages, poolRequisites, gradePages] = await Promise.all([
      inParallel(batches(ids, BATCH), async (batch) => {
        const {data, error} = await db.from('courses').select(COURSE_COLUMNS).in('id', batch);
        if (error) throw error;
        return data as CatalogRows['courses'];
      }),
      loadRequisites(db, term, ids),
      inParallel(batches(ids, BATCH), async (batch) => {
        const {data, error} = await db.from('course_grade_stats').select('course_id, a_ab_rate, sample_size').in('course_id', batch);
        if (error) throw error;
        return data as CatalogRows['stats'];
      }),
      loadAliases(db, ids, aliases),
    ]);
    for (const [id, row] of poolRequisites) aliases.set(id, [...new Set([...(aliases.get(id) ?? []), ...(row.course_aliases ?? [])])]);
    // Graduate courses only for students in a graduate program or already planning one.
    const allowGraduate = graduateProgram(program) || courses.some((course) => graduateLevel(course.code));
    const publishedCourses = await termCourseRows(db, term, coursePages.flat());
    const assessed = assess(publishedCourses.filter((course) => (!done.has(course.id) || course.repeatable) && (allowGraduate || !graduateLevel(course.code))), poolRequisites, true).accepted;

    // 3. Rank by relevance and grade outcomes, then keep the best for the optimizer.
    const grades = new Map(gradePages.flat().map((row) => [row.course_id, row]));
    const designationTags = new Map(designated.map((course) => [course.id, course.breadth ?? []]));
    const subjects = new Set([...courses.map(({code}) => code), ...history.flatMap((record) => record.courses?.code ? [record.courses.code] : [])].flatMap((code) => subjectOf(code) ?? []));
    const candidates: Candidate[] = assessed.map((course) => ({
      id: course.id,
      code: course.code,
      credits: Math.max(...course.credit_options),
      major: [course.code, ...(aliases.get(course.id) ?? [])].some((code) => majorRules.has(code.trim().replace(/\s+/g, ' ').toUpperCase())),
      designation: designationTags.has(course.id),
      related: subjects.has(subjectOf(course.code) ?? ''),
      eligible: course.eligibility === 'eligible',
      easy: knownEasy([course.code, ...(aliases.get(course.id) ?? [])]),
      grade: grades.get(course.id) ?? null,
    }));
    const majorCount = inputs.maxMajorCourses ?? (inputs.balanceMajorCourses ? 'balanced' : 'none');
    const picked = pickCandidates(candidates, OPTIONAL_LIMIT, majorCount);
    const byId = new Map(assessed.map((course) => [course.id, course]));
    courses.push(...picked.map((candidate) => {
      const course = {...byId.get(candidate.id)!, requirement_fit: relevance(candidate), known_easy: candidate.easy || undefined};
      const tags = designationTags.get(candidate.id);
      return tags?.length ? {...course, breadth: [...new Set([...(course.breadth ?? []), ...tags])]} : course;
    }));
    catalogPool = picked.length > 0;
    console.info('DIG candidates', {term, courses: sectionsOf.size, fit: usable.size, takeable: assessed.length, sent: picked.length, ms: Date.now() - started});
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
  const majorCourses: Record<string, string[]> = {};
  {
    if (!majorRules.size && !explicitMajor.size) {
      if (inputs.maxMajorCourses !== undefined && inputs.maxMajorCourses !== null) return {error: 'Set your academic program or mark planned courses for your major before using the major-course limit.'};
      inputs.balanceMajorCourses = false;
    }
    for (const course of courses) {
      const codes = [course.code, ...(aliases.get(course.id) ?? [])].map((code) => code.trim().replace(/\s+/g, ' ').toUpperCase());
      const reasons = [...new Set(codes.flatMap(code => majorRules.get(code) ?? []))];
      course.is_major_course = explicitMajor.has(course.id) || reasons.length > 0;
      if (course.is_major_course) majorCourses[course.id] = reasons.length ? reasons : ['Marked as a major course'];
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
  const chosen = new Set(ids);
  const [bundles, meetings, stats] = await Promise.all([
    termSections ? termSections.bundles.filter((bundle) => chosen.has(bundle.course_id))
      : readSections<CatalogRows['bundles'][number]>('section_bundles', 'course_id, bundle_id, seat_status, instructor_score', 'bundle_id'),
    termSections ? termSections.meetings.filter((meeting) => chosen.has(meeting.course_id))
      : readSections<CatalogRows['meetings'][number]>('meetings', 'course_id, bundle_id, day, start_min, end_min, mode, building_id', 'id'),
    Promise.all(courseBatches.map(async (batch) => {
      const {data, error} = await db.from('course_grade_stats').select('course_id, a_ab_rate, sample_size').in('course_id', batch);
      if (error) throw error;
      return data;
    })),
  ]);
  // Must-takes keep every section; a course DIG added keeps only the sections that fit (never a full one).
  const availableBundles = bundles.filter((bundle) => plannedSet.has(bundle.course_id) || (usable.get(bundle.course_id)?.has(bundle.bundle_id) ?? bundle.seat_status !== 'full'));
  const kept = new Set(availableBundles.map((bundle) => `${bundle.course_id}|${bundle.bundle_id}`));
  const availableMeetings = meetings.filter((meeting) => kept.has(`${meeting.course_id}|${meeting.bundle_id}`));

  const rows: CatalogRows = {
    courses,
    bundles: availableBundles,
    meetings: availableMeetings,
    stats: stats.flat() as CatalogRows['stats'],
    edges: await walkingEdges(db, availableMeetings),
    completedCourseIds: [...new Set([
      ...history.filter(record => record.status === 'completed' && record.grade_entries?.letter_grade !== 'F').map(record => record.course_id),
      ...transfers.flatMap(row => row.equivalent_course_id && row.awarded_term <= term ? [row.equivalent_course_id] : []),
    ])],
  };
  // A random id per request: nothing that identifies the user leaves this server.
  const request = toGenerateRequest(inputs, rows, randomUUID());
  if (catalogPool) {
    // Search every candidate, and rank by degree fit as well as grades, walks, gaps and days.
    request.preferences.catalog_search = true;
    request.preferences.weights.degree_fit = DEGREE_FIT_WEIGHT;
    request.preferences.weights.known_easy = KNOWN_EASY_WEIGHT;
  }
  if (!request.courses.length) return {error: 'Every course DIG found meets online only. Allow online classes or add a must-take course.'};
  return {request, majorCourses};
}

export async function buildGenerateRequestFromDb(raw: unknown): Promise<GenerateRequest | {error: string}> {
  const context = await buildGenerateContextFromDb(raw);
  return 'error' in context ? context : context.request;
}
