import {expect, test, vi} from 'vitest';
import {buildGenerateRequestFromDb} from './dig-server';
import {supabaseServer} from './supabase-server';

vi.mock('./supabase-server', () => ({supabaseServer: vi.fn()}));

const cs200 = {id: 'uw-024794', code: 'COMP SCI 200', credit_options: [3], repeatable: false};
const cs400 = {id: 'uw-024798', code: 'COMP SCI 400', credit_options: [3], repeatable: false};
const stat = {id: 'uw-025501', code: 'STAT 340', credit_options: [3], repeatable: false};
const social = {id: 'uw-030001', code: 'SOC 101', credit_options: [3], repeatable: false, breadth: ['S']};
const laterBreadths = Array.from({length: 750}, (_, index) => ({
  id: `qa-breadth-${index}`, code: `QA ${index + 100}`, credit_options: [3], repeatable: false, breadth: ['S'],
}));

test.each([
  {name: 'an unchecked planned course', planned: [cs200, cs400, stat], related: false, preferred: [], maxMajor: null},
  {name: 'a same-subject suggestion', planned: [cs200, stat], related: true, preferred: [], maxMajor: null},
  {name: 'a preferred breadth suggestion', planned: [cs200, stat], related: false, preferred: ['S'], maxMajor: null},
  {name: 'a published term breadth suggestion', planned: [cs200, stat], related: false, preferred: ['S'], maxMajor: null, published: true},
  {name: 'a preferred Comm B suggestion', planned: [cs200, stat], related: false, preferred: ['COMM_B'], maxMajor: null},
  {name: 'a preferred Ethnic Studies suggestion', planned: [cs200, stat], related: false, preferred: ['ETHNIC'], maxMajor: null},
  {name: 'a combined breadth and GenEd suggestion', planned: [cs200, stat], related: false, preferred: ['S', 'COMM_B'], maxMajor: null, published: true},
  {name: 'a major-course cap', planned: [cs200, stat], related: false, preferred: ['S'], maxMajor: 1},
])('excludes a course with a missing requisite when it is $name', async ({planned, related, preferred, maxMajor, published}) => {
  const hasBreadth = preferred.includes('S');
  const genEd = preferred.includes('COMM_B') || preferred.includes('ETHNIC');
  const catalog = [{...cs400, breadth: ['S']}, social, ...(hasBreadth ? laterBreadths : [])];
  const db = {
    auth: {getUser: async () => ({data: {user: {id: 'qa-user'}}})},
    from: (table: string) => ({
      select(columns: string) {
        let data: unknown[] | {program_id: string; academic_programs: {label: string}} = [];
        if (table === 'courses') {
          data = columns.includes('section_bundles')
            ? preferred.length ? catalog.map(row => published ? {...row, breadth: null} : row) : [cs400]
            : planned;
        }
        if (table === 'planner_courses' && columns === 'course_id, counts_toward_major') {
          data = planned.map(({id}) => ({course_id: id, counts_toward_major: false}));
        }
        if (table === 'student_programs') data = [{program_id: 'qa-program', kind: 'major', is_primary: true, name: 'Computer Sciences, BS'}];
        if (table === 'program_requirement_course_options') data = [{course_code: cs200.code}];
        if (table === 'course_designations' && (published || genEd)) data = catalog.map(({id, breadth}) => ({
          course_id: id,
          breadth_codes: breadth,
          general_ed_code: id === social.id && preferred.includes('COMM_B') ? 'B' : null,
          ethnic_studies_code: id === social.id && preferred.includes('ETHNIC') ? 'E' : null,
        }));
        if (table === 'course_requisites') data = [
          {course_id: cs400.id, course_aliases: [cs400.code], enrollment_requisites: 'COMP SCI 300'},
          ...[cs200, stat, social].map(course => ({course_id: course.id, enrollment_requisites: 'None'})),
        ];
        const chain = () => query;
        const query = {
          eq: chain, ilike: chain, lte: chain, neq: chain, or: chain, order: chain, overlaps: chain,
          in(column: string, ids: string[]) {
            if (table === 'courses' && column === 'id' && Array.isArray(data)) {
              data = data.filter(row => ids.includes((row as {id: string}).id));
            }
            return query;
          },
          range(start: number, end: number) { if (Array.isArray(data)) data = data.slice(start, end + 1); return query; },
          limit(count: number) { if (Array.isArray(data)) data = data.slice(0, count); return query; },
          maybeSingle: chain, overrideTypes: chain,
          then(resolve: (value: {data: typeof data; error: null}) => unknown) { return Promise.resolve({data, error: null}).then(resolve); },
        };
        return query;
      },
    }),
  };
  vi.mocked(supabaseServer).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof supabaseServer>>);

  const result = await buildGenerateRequestFromDb({
    term: '1274', min_credits: 9, max_credits: 9, required: [cs200.id, stat.id],
    earliest: 480, latest: 1140, blocked: [], related, preferred_breadths: preferred, max_major_courses: maxMajor,
  });

  if ('error' in result) throw new Error(result.error);
  expect(result.courses.map(({course_id}) => course_id)).toEqual(preferred.length
    ? [cs200.id, stat.id, social.id, ...(hasBreadth ? laterBreadths.map(({id}) => id) : [])] : [cs200.id, stat.id]);
  if (preferred.length) {
    expect(result.preferences.preferred_breadths).toEqual(preferred);
    expect(result.preferences.catalog_search).toBe(true);
    expect(result.courses.find(course => course.course_id === social.id)?.breadth).toEqual(['S', ...preferred.filter((code) => code !== 'S')]);
    if (hasBreadth) expect(result.courses.find(course => course.course_id === laterBreadths.at(-1)?.id)?.breadth).toEqual(['S']);
  }
  expect(result.courses.filter(course => !course.course_id.startsWith('qa-'))
    .every(course => course.eligibility_status === 'eligible')).toBe(true);
  if (maxMajor !== null) {
    expect(result.constraints.max_major_courses).toBe(1);
    expect(result.courses.find(course => course.course_id === cs200.id)?.is_major_course).toBe(true);
    expect(result.courses.find(course => course.course_id === social.id)?.is_major_course).toBe(false);
  }
});
