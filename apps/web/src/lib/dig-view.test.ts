import {expect, test} from 'vitest';
import expected from '../mocks/expected.json';
import request from '../mocks/request.json';
import {DEFAULT_CONDITIONS, blockers, conditionsChip, describeOptions, loosenChoices, toDigBody, walkChecks, type DigResponse} from './dig-view';
import {parseDigInputs} from './dig-request';

const response = expected as DigResponse;
const required = request.courses.map((course) => course.course_id);

test('toDigBody aims one credit under the target at most, blocks days off and the weekend, and passes validation', () => {
  const body = toDigBody('2027SP', DEFAULT_CONDITIONS, ['cs400'], 3);
  expect(body).toMatchObject({min_credits: 13, max_credits: 14, earliest: 540, latest: 960, blocked: ['FRI', 'SAT', 'SUN'], related: true});
  expect(body).not.toHaveProperty('prefer');
  expect(body.max_major_courses).toBeNull();
  expect('error' in parseDigInputs(body)).toBe(false);
  // Must-takes that already exceed the target raise it instead of producing an impossible range.
  expect(toDigBody('2027SP', {...DEFAULT_CONDITIONS, credits: 8}, ['a', 'b', 'c'], 11)).toMatchObject({min_credits: 11, max_credits: 11});
  expect(toDigBody('2027SP', {...DEFAULT_CONDITIONS, credits: 21}, ['cs400'], 3).max_credits).toBe(18);
  expect(toDigBody('2027SP', {...DEFAULT_CONDITIONS, breadths: ['H', 'S']}, ['cs400'], 3).preferred_breadths).toEqual(['H', 'S']);
  expect(toDigBody('2027SP', {...DEFAULT_CONDITIONS, majorPreference: 2}, ['cs400'], 3).max_major_courses).toBe(2);
  expect(body.balance_major_courses).toBe(true);
  expect(toDigBody('2027SP', {...DEFAULT_CONDITIONS, majorPreference: 'none'}, ['cs400'], 3).balance_major_courses).toBe(false);
});

test('conditionsChip reads like the design: term, credits, days, hours', () => {
  expect(conditionsChip('Spring 2027', DEFAULT_CONDITIONS)).toBe('Spring 2027 · 14 cr · M–Th · 9–4');
  expect(conditionsChip('Fall 2026', {...DEFAULT_CONDITIONS, days: [true, false, true, false, true], earliest: 630})).toBe('Fall 2026 · 14 cr · M, W, F · 10:30–4');
  expect(conditionsChip('Fall 2026', {...DEFAULT_CONDITIONS, breadths: ['H']})).toContain(' · H');
  expect(conditionsChip('Fall 2026', {...DEFAULT_CONDITIONS, breadths: ['COMM_B', 'ETHNIC']})).toContain(' · Comm B, Ethnic Studies');
  expect(conditionsChip('Fall 2026', {...DEFAULT_CONDITIONS, majorPreference: 2})).toContain(' · ≤2 major');
});

test('walkChecks finds the longest single walk and matches the optimizer’s weekly totals', () => {
  const walks = walkChecks(response.results, request.walking_edges);
  expect(walks.map((walk) => walk.max)).toEqual([0, 6, 18]); // twice a week each: 0, 12 and 36 minutes
  expect(walks[1].tight).toEqual({day: 'MON', end_min: 650, start_min: 660}); // 10 minutes for a 6-minute walk
  expect(walks[2].tight).toBeNull();
});

test('walkChecks reports unknown walks instead of guessing', () => {
  const walks = walkChecks(response.results, []);
  expect(walks[0]).toMatchObject({max: 0, unknown: []}); // same building all day needs no data
  expect(walks[1]).toMatchObject({max: null, unknown: ['BETA']});
});

test('describeOptions labels the cards and picks one thing to check', () => {
  const withWalks = {...response, walks: walkChecks(response.results, request.walking_edges)};
  const onTarget = {...DEFAULT_CONDITIONS, credits: 10};
  const options = describeOptions(withWalks, onTarget, required, (id) => `${id} Hall`);
  expect(options.map((option) => [option.tag, option.walk, option.check])).toEqual([
    ['Best match', '0 min', null],
    [null, '6 min', 'Tight transfer Mon 10:50 → 11:00'],
    [null, '18 min', null],
  ]);
  expect(options[0].added).toEqual([]); // every course was a must-take
  expect(describeOptions(withWalks, onTarget, ['cs400'], String)[0].added).toEqual(['MATH 234', 'STAT 240']);
  expect(describeOptions(withWalks, {...onTarget, credits: 12}, required, String)[0].check).toBe('2 credits under your target');

  const unverified = describeOptions({...response, walks: walkChecks(response.results, [])}, onTarget, required, (id) => `${id} Hall`);
  expect(unverified[1]).toMatchObject({walk: null, check: 'No walking data for BETA Hall'});
});

test('an empty result explains itself and offers ways to loosen the conditions', () => {
  expect(blockers(['outside_time_window', 'blocked_day'], DEFAULT_CONDITIONS, ['COMP SCI 540']).map((item) => item.body)).toEqual([
    'Some sections meet before 9 AM or after 4 PM.',
    'Some sections meet on Fri.',
  ]);
  const choices = loosenChoices(DEFAULT_CONDITIONS, 7);
  expect(choices.map((choice) => choice.label)).toEqual(['End by 5:30 PM', 'Allow Friday', 'Start at 8 AM']);
  expect(choices[0].apply(DEFAULT_CONDITIONS).latest).toBe(1050);
  expect(choices[1].apply(DEFAULT_CONDITIONS).days).toEqual([true, true, true, true, true]);
  expect(choices[2].apply(DEFAULT_CONDITIONS).earliest).toBe(480);
});
