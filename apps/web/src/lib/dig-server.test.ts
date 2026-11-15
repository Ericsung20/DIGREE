import {expect, test, vi} from 'vitest';
import {buildGenerateRequestFromDb} from './dig-server';
import {supabaseServer} from './supabase-server';

vi.mock('./supabase-server', () => ({supabaseServer: vi.fn()}));

const cs200 = {id: 'uw-024794', code: 'COMP SCI 200', credit_options: [3], repeatable: false};
const cs400 = {id: 'uw-024798', code: 'COMP SCI 400', credit_options: [3], repeatable: false};
const stat = {id: 'uw-025501', code: 'STAT 340', credit_options: [3], repeatable: false};
const social = {id: 'uw-030001', code: 'SOC 101', credit_options: [3], repeatable: false, breadth: ['S']};

test.each([
  {name: 'an unchecked planned course', planned: [cs200, cs400, stat], related: false, preferred: []},
  {name: 'a same-subject suggestion', planned: [cs200, stat], related: true, preferred: []},
  {name: 'a preferred breadth suggestion', planned: [cs200, stat], related: false, preferred: ['S']},
])('excludes a course with a missing requisite when it is $name', async ({planned, related, preferred}) => {
  const db = {
    auth: {getUser: async () => ({data: {user: {id: 'qa-user'}}})},
    from: (table: string) => ({
      select(columns: string) {
        let data: unknown[] | {academic_programs: {label: string}} = [];
        if (table === 'courses') {
          data = columns.includes('section_bundles')
            ? preferred.length ? [{...cs400, breadth: ['S']}, social] : [cs400]
            : planned;
        }
        if (table === 'user_course_records' && columns === 'course_id') {
          data = planned.map(({id}) => ({course_id: id}));
        }
        if (table === 'academic_profiles') data = {academic_programs: {label: 'Computer Sciences, BS'}};
        if (table === 'course_requisites') data = [
          {course_id: cs400.id, course_aliases: [cs400.code], enrollment_requisites: 'COMP SCI 300'},
          ...[cs200, stat, social].map(course => ({course_id: course.id, enrollment_requisites: 'None'})),
        ];
        const result = Promise.resolve({data, error: null});
        const chain = () => query;
        const query = {
          eq: chain, ilike: chain, in: chain, lte: chain, neq: chain, order: chain, overlaps: chain, range: chain,
          maybeSingle: chain, limit: chain, overrideTypes: chain, then: result.then.bind(result),
        };
        return query;
      },
    }),
  };
  vi.mocked(supabaseServer).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof supabaseServer>>);

  const result = await buildGenerateRequestFromDb({
    term: '1274', min_credits: 9, max_credits: 9, required: [cs200.id, stat.id],
    earliest: 480, latest: 1140, blocked: [], related, preferred_breadths: preferred,
  });

  if ('error' in result) throw new Error(result.error);
  expect(result.courses.map(({course_id}) => course_id)).toEqual(preferred.length ? [cs200.id, stat.id, social.id] : [cs200.id, stat.id]);
  if (preferred.length) {
    expect(result.preferences.preferred_breadths).toEqual(['S']);
    expect(result.courses.find(course => course.course_id === social.id)?.breadth).toEqual(['S']);
  }
  expect(result.courses.every(course => course.eligibility_status === 'eligible')).toBe(true);
});
