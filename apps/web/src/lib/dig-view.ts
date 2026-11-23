// Pure presentation logic for DIG: turns conditions and an optimizer response into what the
// Recommendations and Schedule Preview screens show. No network, no storage, so it runs in tests.
import type {components} from './contract/types';
import {BREADTH_OPTIONS} from './breadth';
import {DAYS} from './time';
import {DAY_SHORT, courseList, dayIndex, dayRange, hourLabel, plural, timeOfDay} from './ui/format';

type S = components['schemas'];
type Day = S['Day'];

/** What the Generate Setup screen collects. Days are Monday to Friday; true means classes are allowed. */
export type DigConditions = {
  credits: number;
  days: boolean[];
  earliest: number;
  latest: number;
  breadths: string[];
  majorPreference: 'balanced' | 'none' | number;
  /** False keeps online and asynchronous sections out of the schedule. */
  online: boolean;
};
export const DEFAULT_CONDITIONS: DigConditions = {credits: 14, days: [true, true, true, true, false], earliest: 540, latest: 960, breadths: [], majorPreference: 'balanced', online: true};
/** The choices the Hours pickers offer, in minutes after midnight. */
export const EARLIEST_RANGE = {from: 420, to: 1140}; // 7 AM to 7 PM
export const LATEST_RANGE = {from: 540, to: 1320}; // 9 AM to 10 PM
export const CREDIT_LIMIT = 18;

/** The request body the browser posts to /api/dig/generate. `mustCredits` is the total of the must-take courses. */
export function toDigBody(term: string, conditions: DigConditions, required: string[], mustCredits: number) {
  const max = Math.min(CREDIT_LIMIT, Math.max(conditions.credits, mustCredits));
  return {
    term,
    // One credit under the target still counts as a match; the option card says so.
    min_credits: Math.max(mustCredits, max - 1),
    max_credits: max,
    required,
    earliest: conditions.earliest,
    latest: conditions.latest,
    blocked: DAYS.filter((_, day) => day > 4 || !conditions.days[day]),
    preferred_breadths: conditions.breadths,
    max_major_courses: typeof conditions.majorPreference === 'number' ? conditions.majorPreference : null,
    balance_major_courses: conditions.majorPreference === 'balanced',
    related: true,
    online: conditions.online,
  };
}

/** "Spring 2027 · 14 cr · M–Th · 9–4": the chip that leads back to the conditions. */
export function conditionsChip(termLabel: string, conditions: DigConditions): string {
  const hour = (min: number) => hourLabel(min).replace(/ [AP]M$/, '');
  const days = conditions.days.flatMap((on, day) => (on ? [day] : []));
  const breadths = conditions.breadths.flatMap((code) => {
    const option = BREADTH_OPTIONS.find((item) => item.code === code);
    return option ? [code.length === 1 ? code : option.label] : [];
  });
  return `${termLabel} · ${conditions.credits} cr · ${dayRange(days)} · ${hour(conditions.earliest)}–${hour(conditions.latest)}${typeof conditions.majorPreference === 'number' ? ` · ≤${conditions.majorPreference} major` : ''}${conditions.online ? '' : ' · In person'}${breadths.length ? ` · ${breadths.join(', ')}` : ''}`;
}

/** Walking facts for one result, worked out next to the walking data and sent with the response. */
export type WalkCheck = {
  rank: number;
  /** Longest single walk between two classes on the same day, in minutes. Null when one is unknown. */
  max: number | null;
  /** Buildings with a class change whose walking time is not in the catalog. */
  unknown: string[];
  /** The class change with the least time to spare, when it is under five minutes. */
  tight: {day: Day; end_min: number; start_min: number} | null;
};

const SLACK_MIN = 5;

export function walkChecks(results: S['ScheduleResult'][], edges: S['WalkingEdge'][]): WalkCheck[] {
  const minutes = new Map<string, number>();
  for (const edge of edges) {
    minutes.set(`${edge.from_building_id}|${edge.to_building_id}`, edge.minutes);
    if (edge.bidirectional !== false && !minutes.has(`${edge.to_building_id}|${edge.from_building_id}`)) minutes.set(`${edge.to_building_id}|${edge.from_building_id}`, edge.minutes);
  }
  return results.map((result) => {
    let max = 0;
    const unknown = new Set<string>();
    let tight: WalkCheck['tight'] = null;
    let slack = SLACK_MIN;
    for (const day of DAYS) {
      const inPerson = result.selected.flatMap((entry) => entry.meetings).filter((meeting) => meeting.day === day && meeting.building_id).sort((a, b) => a.start_min - b.start_min);
      for (let i = 1; i < inPerson.length; i++) {
        const [from, to] = [inPerson[i - 1], inPerson[i]];
        if (from.building_id === to.building_id) continue;
        const walk = minutes.get(`${from.building_id}|${to.building_id}`);
        if (walk === undefined) {
          unknown.add(to.building_id!);
          continue;
        }
        max = Math.max(max, walk);
        const spare = to.start_min - from.end_min - walk;
        if (spare < slack) {
          slack = spare;
          tight = {day, end_min: from.end_min, start_min: to.start_min};
        }
      }
    }
    return {rank: result.rank, max: unknown.size ? null : max, unknown: [...unknown], tight};
  });
}

/** `sample` marks results that come from the shared fixture rather than the signed-in user's courses. */
export type DigResponse = S['GenerateResponse'] & {walks?: WalkCheck[]; sample?: boolean; sections?: SectionChoices};

/** One section a result's course could switch to on the Schedule Preview. */
export type SectionChoice = {bundle_id: string; seat_status: S['SectionBundle']['seat_status']; meetings: S['Meeting'][]};
/** By course id: every section of the courses in the results that meets the conditions on its own. */
export type SectionChoices = Record<string, SectionChoice[]>;

/**
 * Sections the preview can switch between. A section qualifies when it keeps to the hours and days
 * the optimizer was given; whether it clashes with the other courses depends on what else is
 * picked, so the preview checks that itself.
 */
export function sectionChoices(results: S['ScheduleResult'][], request: Pick<S['GenerateRequest'], 'courses' | 'constraints'>): SectionChoices {
  const {earliest_start_min: earliest, latest_end_min: latest, blocked_days: blocked} = request.constraints;
  const wanted = new Set(results.flatMap((result) => result.selected.map((entry) => entry.course_id)));
  const choices: SectionChoices = {};
  for (const course of request.courses) {
    if (!wanted.has(course.course_id)) continue;
    choices[course.course_id] = course.section_bundles
      .filter((bundle) => bundle.meetings.every((meeting) => meeting.start_min >= earliest && meeting.end_min <= latest && !blocked.includes(meeting.day)))
      .map(({bundle_id, seat_status, meetings}) => ({bundle_id, seat_status, meetings}));
  }
  return choices;
}

/** The first pair of selected courses that meet at the same time, or null when nothing overlaps. */
export function sectionClash(selected: Pick<S['SelectedBundle'], 'course_code' | 'meetings'>[]): {codes: [string, string]; day: Day} | null {
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      for (const a of selected[i].meetings) {
        const b = selected[j].meetings.find((meeting) => meeting.day === a.day && meeting.start_min < a.end_min && a.start_min < meeting.end_min);
        if (b) return {codes: [selected[i].course_code, selected[j].course_code], day: a.day};
      }
    }
  }
  return null;
}

/** One card of the Recommendations deck. */
export type DigOption = {
  rank: number;
  tag: string | null;
  credits: number;
  /** "6 min", or null when a walking time is unverified. */
  walk: string | null;
  /** The one thing to look at before saving, or null when the option is all clear. */
  check: string | null;
  /** Codes of the courses DIG added on top of the must-takes. */
  added: string[];
  result: S['ScheduleResult'];
};

const warningCode = (warning: string) => warning.split(': ', 1)[0];
export function describeOptions(response: DigResponse, conditions: DigConditions, required: string[], buildingName: (id: string) => string): DigOption[] {
  const used = new Set<string>();
  const target = Math.max(conditions.credits, 0);
  return response.results.map((result, i) => {
    const meetings = result.selected.flatMap((entry) => entry.meetings);
    const walk = response.walks?.find((item) => item.rank === result.rank);
    const codes = result.warnings.map(warningCode);
    const walkUnknown = walk ? walk.max === null : codes.some((code) => code === 'walking_time_unknown' || code === 'building_unknown' || code === 'location_uncertain');

    const campusDays = new Set(meetings.map((meeting) => meeting.day)).size;
    const firstStart = meetings.length ? Math.min(...meetings.map((meeting) => meeting.start_min)) : 0;
    const candidates = [i === 0 ? (response.diagnostics.search_truncated ? 'Best found' : 'Best match') : null, meetings.length && firstStart >= 720 ? 'Free mornings' : null, meetings.length && firstStart >= 630 ? 'Late start' : null, meetings.length && campusDays <= 3 ? plural(campusDays, 'day') : null];
    const tag = candidates.find((candidate): candidate is string => candidate !== null && !used.has(candidate)) ?? null;
    if (tag) used.add(tag);

    const under = target - result.metrics.total_credits;
    let check: string | null = null;
    if (walk?.unknown.length) check = `No walking data for ${buildingName(walk.unknown[0])}`;
    else if (walkUnknown) check = codes.includes('location_uncertain') ? 'An online class sits right next to an in-person one' : 'A class has no building listed';
    else if (codes.includes('section_full_included')) check = 'Includes a section reported as full';
    else if (walk?.tight) check = `Tight transfer ${DAY_SHORT[dayIndex(walk.tight.day)]} ${timeOfDay(walk.tight.end_min).replace(/ [AP]M$/, '')} → ${timeOfDay(walk.tight.start_min).replace(/ [AP]M$/, '')}`;
    else if (under > 0) check = `${plural(under, 'credit')} under your target`;
    else if (codes.includes('search_incomplete')) check = 'DIG stopped before checking every combination';

    return {
      rank: result.rank,
      tag,
      credits: result.metrics.total_credits,
      walk: walkUnknown ? null : walk ? `${walk.max} min` : null,
      check,
      added: result.selected.filter((entry) => !required.includes(entry.course_id)).map((entry) => entry.course_code),
      result,
    };
  });
}

/** "Mon–Thu": the days a result has class. */
export function campusDays(result: S['ScheduleResult']): string {
  return dayRange([...new Set(result.selected.flatMap((entry) => entry.meetings.map((meeting) => dayIndex(meeting.day))))], DAY_SHORT);
}

const dayOff = (conditions: DigConditions) => conditions.days.findIndex((on) => !on);

/** Why nothing fit, as the cards of the empty state: a short subject and one sentence. */
export function blockers(reasons: string[], conditions: DigConditions, mustTake: string[]): {title: string; body: string}[] {
  const courses = mustTake.length ? courseList(mustTake) : 'Must-take courses';
  const off = conditions.days.flatMap((on, day) => (on ? [] : [DAY_SHORT[day]]));
  const copy: Record<string, {title: string; body: string}> = {
    search_truncated: {title: 'Too many combinations', body: 'DIG reached its search limit before finding a fit. Try fewer must-take courses.'},
    required_course_ineligible: {title: courses, body: 'A must-take course is marked as one you can’t take.'},
    required_course_already_completed: {title: courses, body: 'You already completed a must-take course that can’t be repeated.'},
    required_course_without_bundles: {title: courses, body: 'A must-take course has no sections with meeting times this term.'},
    no_usable_optional_courses: {title: `${conditions.credits} credits`, body: 'DIG found no other course it could add to reach your target.'},
    max_major_courses_exceeded: {title: 'Major course limit', body: 'A schedule needs more major courses than your limit allows. Raise the limit or change a must-take course.'},
    credits_out_of_range: {title: `${conditions.credits} credits`, body: 'The combinations that fit land outside your credit target.'},
    section_full: {title: courses, body: 'A section you would need is full.'},
    outside_time_window: {title: 'Hours', body: `Some sections meet before ${hourLabel(conditions.earliest)} or after ${hourLabel(conditions.latest)}.`},
    blocked_day: {title: 'Days', body: off.length ? `Some sections meet on ${off.join(', ')}.` : 'Some sections meet on the weekend.'},
    time_overlap: {title: courses, body: 'The sections that are left meet at the same time.'},
    insufficient_walk_time: {title: 'Walks', body: 'There is too little time to walk between some classes.'},
    walk_exceeds_max: {title: 'Walks', body: 'Some walks between classes are longer than the limit.'},
  };
  return reasons.map((reason) => copy[reason] ?? {title: 'Conditions', body: reason});
}

/** One-tap ways to relax the conditions after an empty result. At most three are offered. */
export function loosenChoices(conditions: DigConditions, mustCredits: number): {label: string; apply: (current: DigConditions) => DigConditions}[] {
  const choices: {label: string; apply: (current: DigConditions) => DigConditions}[] = [];
  if (conditions.latest < LATEST_RANGE.to) {
    const later = Math.min(LATEST_RANGE.to, conditions.latest + 90);
    choices.push({label: `End by ${hourLabel(later)}`, apply: (current) => ({...current, latest: later})});
  }
  const off = dayOff(conditions);
  if (off >= 0) choices.push({label: `Allow ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][off]}`, apply: (current) => ({...current, days: current.days.map((on, day) => on || day === off)})});
  if (!conditions.online) choices.push({label: 'Allow online classes', apply: (current) => ({...current, online: true})});
  if (conditions.earliest > EARLIEST_RANGE.from) {
    const earlier = Math.max(EARLIEST_RANGE.from, conditions.earliest - 60);
    choices.push({label: `Start at ${hourLabel(earlier)}`, apply: (current) => ({...current, earliest: earlier})});
  }
  if (conditions.credits > Math.max(mustCredits, 1)) {
    const fewer = Math.max(mustCredits, conditions.credits - 3, 1);
    choices.push({label: `Aim for ${fewer} credits`, apply: (current) => ({...current, credits: fewer})});
  }
  return choices.slice(0, 3);
}
