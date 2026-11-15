import {expect, test} from 'vitest';
import {parseDigInputs, toGenerateRequest, type CatalogRows, type DigInputs} from './dig-request';
import {assertNoUserData} from './optimizer';

const body = {term: '1274', min_credits: '6', max_credits: 7, required: ['a', 'a'], earliest: '480', latest: 1140, blocked: ['FRI']};

test('parseDigInputs accepts form values and normalizes them', () => {
  expect(parseDigInputs(body)).toEqual({term: '1274', minCredits: 6, maxCredits: 7, required: ['a'], earliest: 480, latest: 1140, blockedDays: ['FRI']});
});

test('parseDigInputs rejects out-of-contract values', () => {
  const bad = (over: object) => 'error' in parseDigInputs({...body, ...over});
  expect('error' in parseDigInputs(null)).toBe(true);
  expect(bad({term: ''})).toBe(true);
  expect(bad({min_credits: 41})).toBe(true);
  expect(bad({min_credits: 9, max_credits: 6})).toBe(true);
  expect(bad({max_credits: 6.5})).toBe(true);
  expect(bad({earliest: 1200, latest: 600})).toBe(true);
  expect(bad({blocked: ['FUNDAY']})).toBe(true);
  expect(bad({required: 'a'})).toBe(true);
});

const inputs: DigInputs = {term: '1274', minCredits: 6, maxCredits: 7, required: ['a'], earliest: 480, latest: 1140, blockedDays: []};
const rows: CatalogRows = {
  courses: [
    {id: 'a', code: 'AAA 101', credit_options: [3], repeatable: false},
    {id: 'b', code: 'BBB 202', credit_options: [3, 4], repeatable: true},
  ],
  bundles: [
    {course_id: 'a', bundle_id: 'a-1', seat_status: 'open', instructor_score: null},
    {course_id: 'b', bundle_id: 'b-1', seat_status: 'full', instructor_score: null},
    {course_id: 'b', bundle_id: 'b-online', seat_status: 'open', instructor_score: null},
  ],
  meetings: [
    {course_id: 'a', bundle_id: 'a-1', day: 'MON', start_min: 600, end_min: 650, mode: 'in_person', building_id: 'B1'},
    {course_id: 'b', bundle_id: 'b-1', day: 'TUE', start_min: 660, end_min: 735, mode: 'in_person', building_id: null},
  ],
  stats: [{course_id: 'a', a_ab_rate: 0.61, sample_size: 420}],
  edges: [],
  completedCourseIds: ['b'],
};

test('toGenerateRequest maps catalog rows to the contract without guessing', () => {
  const req = toGenerateRequest(inputs, rows, 'req-1');
  expect(req.contract_version).toBe('1.0');
  expect(req.constraints).toMatchObject({min_credits: 6, max_credits: 7, earliest_start_min: 480, latest_end_min: 1140, blocked_days: []});
  const [a, b] = req.courses;
  expect(a).toMatchObject({course_id: 'a', course_code: 'AAA 101', is_required: true, already_completed: false, eligibility_status: 'unknown', requirement_fit: null, grade_stats: {a_ab_rate: 0.61, sample_size: 420}});
  expect(b).toMatchObject({is_required: false, already_completed: true, repeatable: true, grade_stats: null, credit_options: [3, 4]});
  expect(a.section_bundles).toEqual([{bundle_id: 'a-1', seat_status: 'open', instructor_score: null, meetings: [{day: 'MON', start_min: 600, end_min: 650, mode: 'in_person', building_id: 'B1'}]}]);
  expect(b.section_bundles.map((x) => [x.bundle_id, x.meetings.length])).toEqual([['b-1', 1], ['b-online', 0]]); // async bundle keeps empty meetings
  expect(b.section_bundles[0].meetings[0].building_id).toBeNull(); // unknown building stays null
  expect(req.walking_edges).toEqual([]); // no walking data means none is sent
  expect(() => assertNoUserData(req)).not.toThrow();
});

// Opt-in: set OPTIMIZER_LIVE_URL=http://127.0.0.1:8000 to check a built request against the running optimizer.
test.skipIf(!process.env.OPTIMIZER_LIVE_URL)('live optimizer accepts a request built from catalog rows', async () => {
  const res = await fetch(`${process.env.OPTIMIZER_LIVE_URL}/v1/schedules/generate`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(toGenerateRequest({...inputs, minCredits: 3, maxCredits: 3}, rows, 'live-test')),
  });
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(200);
  expect(json.results.length).toBeGreaterThan(0);
  expect(json.results[0].selected.map((s: {bundle_id: string}) => s.bundle_id)).toEqual(['a-1']);
  expect(json.results[0].status).toBe('needs_review'); // eligibility is unknown, so the optimizer flags it
});
