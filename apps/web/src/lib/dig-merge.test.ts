import {expect, test, vi} from 'vitest';
import {buildGenerateRequestFromDb} from './dig-server';
import {supabaseServer} from './supabase-server';

vi.mock('./supabase-server', () => ({supabaseServer: vi.fn()}));

// A term whose published credits/repeatability differ from the latest catalog.
// Source-less transfer credit supplies a cross-listed prerequisite; the second
// major recognizes a course by an alias absent from that term's requisite row.
function catalogDb(withTransfer: boolean, required: boolean) {
  const courses = [
    {id: 'uw-next', code: 'COMP SCI 400', credit_options: [3], repeatable: false},
    {id: 'uw-cross', code: 'COMP SCI 240', credit_options: [3], repeatable: false},
    {id: 'uw-math', code: 'STAT 340', credit_options: [3], repeatable: false},
    {id: 'uw-repeat', code: 'MUSIC 113', credit_options: [1], repeatable: false},
  ];
  const tables: Record<string, Record<string, unknown>[]> = {
    courses,
    planner_courses: required ? [{course_id: 'uw-next', counts_toward_major: false}] : [],
    course_attempts: [{course_id: 'uw-repeat', term: '1272', status: 'completed', courses: {code: 'MUSIC 113'}, grade_entries: {letter_grade: 'A'}, terms: {is_current: false}}],
    transfer_credits: withTransfer ? [{equivalent_course_id: 'uw-cross', awarded_term: '1272', courses: {code: 'COMP SCI 240'}, institution: null, source_course: null}] : [],
    student_programs: [
      {program_id: 'primary', kind: 'major', is_primary: true, name: 'Computer Sciences, BS'},
      {program_id: 'additional', kind: 'major', is_primary: false, name: 'Mathematics, BS'},
    ],
    program_requirement_course_options: [{program_id: 'additional', course_code: 'MATH 340'}],
    course_aliases: [{course_id: 'uw-cross', code: 'MATH 240'}, {course_id: 'uw-math', code: 'MATH 340'}],
    course_requisites: courses.map(course => ({course_id: course.id, course_aliases: [course.code], enrollment_requisites: course.id === 'uw-next' ? 'MATH 240' : 'None'})),
    course_offerings: courses.map(course => ({course_id: course.id, credit_options: course.id === 'uw-next' ? [4] : course.credit_options, repeatable: course.id === 'uw-repeat', breadth: []})),
    section_bundles: courses.map(course => ({course_id: course.id, bundle_id: `${course.id}-A`, seat_status: 'open', instructor_score: null})),
    meetings: courses.map((course, index) => ({course_id: course.id, bundle_id: `${course.id}-A`, day: 'MON', start_min: 540 + index * 60, end_min: 590 + index * 60, mode: 'in_person', building_id: null})),
  };
  const read = vi.fn((table: string) => ({
    select() {
      let data = [...(tables[table] ?? [])];
      const query = {
        eq() {return query;}, lte() {return query;}, order() {return query;}, overrideTypes() {return query;},
        in(column: string, values: unknown[]) {data = data.filter(row => values.includes(row[column])); return query;},
        range(start: number, end: number) {data = data.slice(start, end + 1); return query;},
        then(resolve: (result: {data: typeof data; count: number; error: null}) => unknown) {
          return Promise.resolve({data, count: data.length, error: null}).then(resolve);
        },
      };
      return query;
    },
  }));
  vi.mocked(supabaseServer).mockResolvedValue({auth: {getUser: async () => ({data: {user: {id: 'owner'}}})}, from: read} as unknown as Awaited<ReturnType<typeof supabaseServer>>);
  return read;
}

const options = {term: '1274', min_credits: 4, max_credits: 4, earliest: 480, latest: 1140, blocked: []};

test('automatic DIG preserves transfers, canonical aliases, additional majors and term snapshots', async () => {
  const read = catalogDb(true, false);
  const request = await buildGenerateRequestFromDb({...options, required: [], balance_major_courses: true});
  if ('error' in request) throw new Error(request.error);
  expect(request.courses.map(course => course.course_id)).not.toContain('uw-cross');
  expect(request.courses.find(course => course.course_id === 'uw-next')).toMatchObject({credit_options: [4], eligibility_status: 'eligible'});
  expect(request.courses.find(course => course.course_id === 'uw-math')).toMatchObject({is_major_course: true, requirement_fit: 1});
  expect(request.courses.find(course => course.course_id === 'uw-repeat')).toMatchObject({repeatable: true, already_completed: true});
  expect(request.preferences.catalog_search).toBe(true);
  expect(read.mock.calls.map(([table]) => table)).not.toContain('user_course_records');
});

test.each([true, false])('must-take prerequisite uses recognized cross-list transfer: %s', async withTransfer => {
  catalogDb(withTransfer, true);
  const request = await buildGenerateRequestFromDb({...options, required: ['uw-next']});
  if (!withTransfer) {
    expect(request).toMatchObject({error: expect.stringContaining('unmet enrollment requisite')});
    return;
  }
  if ('error' in request) throw new Error(request.error);
  expect(request.courses).toHaveLength(1);
  expect(request.courses[0]).toMatchObject({course_id: 'uw-next', is_required: true, credit_options: [4], eligibility_status: 'eligible'});
});
