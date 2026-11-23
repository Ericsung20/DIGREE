import {expect, test} from 'vitest';
import expected from '../mocks/expected.json';
import request from '../mocks/request.json';
import {DEFAULT_CONDITIONS, blockers, conditionsChip, describeOptions, allTimetables, loosenChoices, majorPreferenceNotice, sectionChoices, toDigBody, walkChecks, type DigResponse} from './dig-view';
import type {GenerateRequest} from './dig-request';
import {parseDigInputs} from './dig-request';

const response = expected as DigResponse;
const required = request.courses.map((course) => course.course_id);

test('relaxed major counts are disclosed without claiming an exhaustive search when truncated', () => {
  expect(majorPreferenceNotice({target: 4, relaxed: false, searchLimited: false})).toBeNull();
  expect(majorPreferenceNotice({target: 4, relaxed: true, searchLimited: true})).toContain('within the search limit');
  expect(majorPreferenceNotice({target: 4, relaxed: true, searchLimited: false})).toContain('up to 4 major courses');
});

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
  expect(body.online).toBe(true);
  const inPerson = toDigBody('2027SP', {...DEFAULT_CONDITIONS, online: false}, [], 0);
  expect(inPerson).toMatchObject({online: false, required: [], min_credits: 13, max_credits: 14});
  expect(parseDigInputs(inPerson)).toMatchObject({online: false, required: []});
});

test('conditionsChip reads like the design: term, credits, days, hours', () => {
  expect(conditionsChip('Spring 2027', DEFAULT_CONDITIONS)).toBe('Spring 2027 · 14 cr · M–Th · 9–4');
  expect(conditionsChip('Fall 2026', {...DEFAULT_CONDITIONS, days: [true, false, true, false, true], earliest: 630})).toBe('Fall 2026 · 14 cr · M, W, F · 10:30–4');
  expect(conditionsChip('Fall 2026', {...DEFAULT_CONDITIONS, breadths: ['H']})).toContain(' · H');
  expect(conditionsChip('Fall 2026', {...DEFAULT_CONDITIONS, breadths: ['COMM_B', 'ETHNIC']})).toContain(' · Comm B, Ethnic Studies');
  expect(conditionsChip('Fall 2026', {...DEFAULT_CONDITIONS, majorPreference: 2})).toContain(' · 2 major first');
  expect(conditionsChip('Fall 2026', {...DEFAULT_CONDITIONS, online: false})).toBe('Fall 2026 · 14 cr · M–Th · 9–4 · In person');
});

test('sectionChoices offers every section of the chosen courses that keeps to the hours and days', () => {
  const req = request as GenerateRequest;
  const choices = sectionChoices(response.results, req);
  const chosen = new Set(response.results.flatMap((result) => result.selected.map((entry) => entry.course_id)));
  expect(Object.keys(choices).sort()).toEqual([...chosen].sort());
  for (const [courseId, list] of Object.entries(choices)) {
    const course = req.courses.find((item) => item.course_id === courseId)!;
    expect(list.map((section) => section.bundle_id)).toEqual(course.section_bundles.map((bundle) => bundle.bundle_id).filter((id) => list.some((section) => section.bundle_id === id)));
    // Every section a result picked is on its list.
    for (const result of response.results) for (const entry of result.selected) if (entry.course_id === courseId) expect(list.map((section) => section.bundle_id)).toContain(entry.bundle_id);
  }
  // Tightening the hours removes the sections that fall outside them.
  const morning = sectionChoices(response.results, {...req, constraints: {...req.constraints, latest_end_min: 600}});
  expect(Object.values(morning).flat().every((section) => section.meetings.every((meeting) => meeting.end_min <= 600))).toBe(true);
  const noMonday = sectionChoices(response.results, {...req, constraints: {...req.constraints, blocked_days: ['MON']}});
  expect(Object.values(noMonday).flat().some((section) => section.meetings.some((meeting) => meeting.day === 'MON'))).toBe(false);
});

test('allTimetables lists every timetable for the courses, DIG’s pick first, without clashes or impossible walks', () => {
  const m = (day: 'MON' | 'TUE' | 'WED', start: number, end: number, building: string) => ({day, start_min: start, end_min: end, mode: 'in_person' as const, building_id: building});
  const section = (bundle_id: string, ...meetings: ReturnType<typeof m>[]) => ({bundle_id, seat_status: 'open' as const, instructor_score: null, meetings});
  const req = {
    constraints: {...(request as GenerateRequest).constraints, earliest_start_min: 480, latest_end_min: 1320, blocked_days: [], walking_buffer_min: 3},
    walking_edges: [{from_building_id: 'X', to_building_id: 'Z', minutes: 10, bidirectional: true}],
    courses: [
      {...(request as GenerateRequest).courses[0], course_id: 'a', section_bundles: [section('A1', m('MON', 600, 650, 'X')), section('A2', m('MON', 700, 750, 'X')), section('A3', m('TUE', 600, 650, 'Y'))]},
      {...(request as GenerateRequest).courses[0], course_id: 'b', section_bundles: [section('B1', m('MON', 600, 650, 'Z')), section('B2', m('MON', 655, 705, 'Z')), section('B3', m('WED', 600, 650, 'Z'))]},
    ],
  };
  const result = {...response.results[0], selected: [
    {course_id: 'a', course_code: 'A 1', bundle_id: 'A1', credits: 3, meetings: [m('MON', 600, 650, 'X')]},
    {course_id: 'b', course_code: 'B 2', bundle_id: 'B3', credits: 3, meetings: [m('WED', 600, 650, 'Z')]},
  ]};
  const {options, more} = allTimetables(result, req);
  // A1+B1 and A2+B2 overlap; A1+B2 leaves 5 minutes for a 10-minute walk.
  expect(options.map((option) => option.bundles.join('+'))).toEqual(['A1+B3', 'A2+B1', 'A2+B3', 'A3+B1', 'A3+B2', 'A3+B3']);
  expect(more).toBe(false);
  expect(options[1]).toMatchObject({campusDays: 1, maxWalk: 10, idleMinutes: 40});
  expect(options.find((option) => option.bundles.join('+') === 'A3+B2')?.maxWalk).toBe(0); // different days, no walk
  const short = allTimetables(result, req, 2);
  expect(short.options.map((option) => option.bundles.join('+'))).toEqual(['A1+B3', 'A2+B1']);
  expect(short.more).toBe(true);
});

test('allTimetables skips sections that clash with themselves or are full, counts same-time sections once, and stops at 20', () => {
  const m = (day: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI', start: number, end: number) => ({day, start_min: start, end_min: end, mode: 'in_person' as const, building_id: 'X'});
  const section = (bundle_id: string, meetings: ReturnType<typeof m>[], seat_status: 'open' | 'full' = 'open') => ({bundle_id, seat_status, instructor_score: null, meetings});
  const base = (request as GenerateRequest).courses[0];
  const req = {
    constraints: {...(request as GenerateRequest).constraints, earliest_start_min: 480, latest_end_min: 1320, blocked_days: [], walking_buffer_min: 0, exclude_full_sections: true},
    walking_edges: [],
    courses: [
      {...base, course_id: 'a', section_bundles: [
        section('A1', [m('MON', 600, 650)]),
        section('A2', [m('TUE', 600, 690), m('TUE', 660, 710)]), // lecture and quiz overlap
        section('A3', [m('WED', 600, 650)], 'full'),
        section('A4', [m('MON', 600, 650)]), // same times as A1, another room
        section('A5', [m('THU', 600, 650)]),
      ]},
    ],
  };
  const result = {...response.results[0], selected: [{course_id: 'a', course_code: 'A 1', bundle_id: 'A1', credits: 3, meetings: [m('MON', 600, 650)]}]};
  expect(allTimetables(result, req).options.map((option) => option.bundles.join('+'))).toEqual(['A1', 'A5']);

  // Two courses with 6 distinct times each: 36 timetables, of which the best 20 are kept.
  const times = (prefix: string, day: 'MON' | 'TUE') => Array.from({length: 6}, (_, i) => section(`${prefix}${i}`, [m(day, 480 + i * 60, 530 + i * 60)]));
  const wide = {...req, courses: [{...base, course_id: 'a', section_bundles: times('A', 'MON')}, {...base, course_id: 'b', section_bundles: times('B', 'TUE')}]};
  const pick = {...response.results[0], selected: [
    {course_id: 'a', course_code: 'A 1', bundle_id: 'A0', credits: 3, meetings: [m('MON', 480, 530)]},
    {course_id: 'b', course_code: 'B 1', bundle_id: 'B0', credits: 3, meetings: [m('TUE', 480, 530)]},
  ]};
  const {options, more} = allTimetables(pick, wide);
  expect(options).toHaveLength(20);
  expect(options[0].bundles).toEqual(['A0', 'B0']);
  expect(more).toBe(true);
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

  const unconfirmed = {...withWalks, results: withWalks.results.map((result) => ({...result, warnings: [...result.warnings, 'eligibility_unknown: Eligibility for MATH 234 has not been confirmed; check it before enrolling.']}))};
  expect(describeOptions(unconfirmed, onTarget, ['cs400'], String)[0].check).toBe('Check the requisites for MATH 234');
  expect(describeOptions(unconfirmed, onTarget, required, String)[0].check).toBeNull(); // a must-take is not flagged

  const unverified = describeOptions({...response, walks: walkChecks(response.results, [])}, onTarget, required, (id) => `${id} Hall`);
  expect(unverified[1]).toMatchObject({walk: null, check: 'No walking data for BETA Hall'});
});

test('an empty result explains itself and offers ways to loosen the conditions', () => {
  expect(blockers(['outside_time_window', 'blocked_day'], DEFAULT_CONDITIONS, ['COMP SCI 540']).map((item) => item.body)).toEqual([
    'Some sections meet before 9 AM or after 4 PM.',
    'Some sections meet on Fri.',
  ]);
  const choices = loosenChoices(DEFAULT_CONDITIONS, 7);
  // Least important first: days, then hours, then credits, then online classes.
  expect(choices.map((choice) => choice.label)).toEqual(['Allow Friday', 'End by 5:30 PM', 'Start at 8 AM']);
  expect(choices[0].apply(DEFAULT_CONDITIONS).days).toEqual([true, true, true, true, true]);
  expect(choices[1].apply(DEFAULT_CONDITIONS).latest).toBe(1050);
  expect(choices[2].apply(DEFAULT_CONDITIONS).earliest).toBe(480);
  const allDays = {...DEFAULT_CONDITIONS, days: [true, true, true, true, true]};
  expect(loosenChoices({...allDays, online: false, credits: 8}, 7).map((choice) => choice.label)).toEqual(['End by 5:30 PM', 'Start at 8 AM', 'Aim for 7 credits']);
  expect(loosenChoices({...allDays, online: false, credits: 7, earliest: 420}, 7).map((choice) => choice.label)).toEqual(['End by 5:30 PM', 'Allow online classes']);
  // The end of the day goes as late as 10 PM.
  expect(loosenChoices({...allDays, latest: 1260}, 7)[0].apply(DEFAULT_CONDITIONS).latest).toBe(1320);
});
