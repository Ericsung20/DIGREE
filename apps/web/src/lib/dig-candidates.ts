// Pure parts of picking the courses DIG may add: which sections fit the conditions and the
// must-takes, and how the remaining courses are ranked. No database, so it runs in tests.
import type {components} from './contract/types';

type Day = components['schemas']['Day'];
type Mode = components['schemas']['Mode'];
export type SlotMeeting = {day: Day; start_min: number; end_min: number; mode: Mode};

/** The hours, days and online preference from the DIG form. */
export type TimeWindow = {earliest: number; latest: number; blockedDays: Day[]; online: boolean};

/**
 * A section DIG may add: it meets at set times inside the window, on allowed days, and in person
 * unless online classes are allowed. Sections without meeting times are mostly independent study,
 * research or asynchronous courses, so DIG does not add them on its own.
 */
export function sectionFits(meetings: SlotMeeting[], window: TimeWindow): boolean {
  if (!meetings.length) return false;
  return meetings.every((meeting) => meeting.start_min >= window.earliest && meeting.end_min <= window.latest
    && !window.blockedDays.includes(meeting.day) && (window.online || meeting.mode !== 'online_sync'));
}

export function sectionsOverlap(a: SlotMeeting[], b: SlotMeeting[]): boolean {
  return a.some((x) => b.some((y) => x.day === y.day && x.start_min < y.end_min && y.start_min < x.end_min));
}

/**
 * Sections of one candidate course that fit the window and leave at least one section of every
 * must-take free. `mustTakes` holds, per must-take course, the meetings of each of its sections
 * that fit the window; a must-take with none is left to the optimizer to report.
 */
export function compatibleSections<T extends {meetings: SlotMeeting[]}>(sections: T[], mustTakes: SlotMeeting[][][], window: TimeWindow): T[] {
  return sections.filter((section) => sectionFits(section.meetings, window)
    && mustTakes.every((options) => !options.length || options.some((meetings) => !sectionsOverlap(section.meetings, meetings))));
}

// Same smoothing as the optimizer (app/scoring.py): a small class's perfect record counts for less.
const GRADE_PRIOR_RATE = 0.5;
const GRADE_PRIOR_STRENGTH = 50;
const UNKNOWN_GRADE = 0.45; // just under the prior, so a course with no data never outranks a known average one

export function smoothedGrade(stats: {a_ab_rate: number; sample_size: number} | null | undefined): number | null {
  if (!stats || stats.sample_size <= 0) return null;
  return (stats.sample_size * Number(stats.a_ab_rate) + GRADE_PRIOR_STRENGTH * GRADE_PRIOR_RATE) / (stats.sample_size + GRADE_PRIOR_STRENGTH);
}

export type Candidate = {
  id: string;
  code: string;
  /** Most credits the course can carry. */
  credits: number;
  /** On the student's program requirement lists. */
  major: boolean;
  /** Matches a course designation the student picked. */
  designation: boolean;
  /** Same subject as a must-take or a course the student has taken. */
  related: boolean;
  /** Requisites confirmed as met; false when the check could not decide. */
  eligible: boolean;
  /** How strongly students recommend it as easy, 0 to 1 (see `knownEasy`). */
  easy?: number;
  grade: {a_ab_rate: number; sample_size: number} | null;
};

/** How well a course fits the student's degree, 0 to 1: sent to the optimizer as its requirement fit. */
export function relevance(course: Pick<Candidate, 'major' | 'designation' | 'related'>): number {
  return course.major ? 1 : course.designation ? 0.8 : course.related ? 0.5 : 0;
}

/**
 * How strongly DIG wants a course, from 0 to about 1. Relevance comes first (program requirement,
 * then a picked designation, then a related subject), then grade outcomes and courses students know
 * as easy, then smaller nudges for confirmed requisites and for carrying enough credits to fill a schedule.
 */
export function candidateScore(course: Candidate): number {
  const grade = smoothedGrade(course.grade) ?? UNKNOWN_GRADE;
  return 0.5 * relevance(course) + 0.4 * grade + 0.4 * (course.easy ?? 0) + (course.eligible ? 0.1 : 0) + (course.credits >= 3 ? 0.05 : 0);
}

/**
 * The best `limit` courses by score. When the major-course count matters, at most 60% of the slots
 * go to major courses so the optimizer has non-major courses to balance with; leftover slots go to
 * whichever group still has courses. A hard limit of 0 leaves major courses out entirely.
 */
export function pickCandidates(candidates: Candidate[], limit: number, majorCount: 'balanced' | 'none' | number): Candidate[] {
  const ranked = [...candidates].sort((a, b) => candidateScore(b) - candidateScore(a) || a.code.localeCompare(b.code));
  if (majorCount === 'none') return ranked.slice(0, limit);
  const majors = majorCount === 0 ? [] : ranked.filter((course) => course.major);
  const others = ranked.filter((course) => !course.major);
  const majorSlots = Math.min(majors.length, Math.max(limit - others.length, Math.ceil(limit * 0.6)));
  const picked = [...majors.slice(0, majorSlots), ...others.slice(0, limit - majorSlots)];
  return picked.sort((a, b) => candidateScore(b) - candidateScore(a) || a.code.localeCompare(b.code));
}

/** UW–Madison numbers graduate-only courses 700 and up; 500–699 are open to undergraduates too. */
export function graduateLevel(code: string): boolean {
  const number = /(\d{3})[A-Z]?$/i.exec(code.trim())?.[1];
  return number !== undefined && Number(number) >= 700;
}

/**
 * Courses students know as easy, beyond what the grade data shows: a subject, optionally limited
 * to some numbers or a number range, and how strongly it is recommended (0 to 1). Whole subjects
 * are "almost all" of their courses, so they count for less than a named course. STEM courses are
 * left to the grade data, which matches how hard they are.
 */
const KNOWN_EASY: {subject: string; numbers?: number[]; range?: [number, number]; strength: number}[] = [
  {subject: 'MUSIC', numbers: [113], strength: 1},
  {subject: 'BIOCHEM', numbers: [104], strength: 0.8},
  {subject: 'ENGL', numbers: [169, 176, 178], strength: 0.8},
  {subject: 'CLASSICS', numbers: [102], strength: 0.8},
  {subject: 'CURRIC', numbers: [277], strength: 0.8},
  {subject: 'ASTRON', range: [100, 199], strength: 0.7},
  {subject: 'ED POL', strength: 0.6},
  {subject: 'L I S', strength: 0.6},
  {subject: 'FOLKLORE', strength: 0.6},
];

/** How strongly a course is recommended as easy, from its code and cross-listed codes; 0 when it is not. */
export function knownEasy(codes: string[]): number {
  let best = 0;
  for (const code of codes) {
    const match = /^(.+?)\s+(\d{3})[A-Z]?$/i.exec(code.trim().replace(/\s+/g, ' '));
    if (!match) continue;
    const subject = match[1].toUpperCase();
    const number = Number(match[2]);
    for (const rule of KNOWN_EASY) {
      if (rule.subject !== subject) continue;
      if (rule.numbers && !rule.numbers.includes(number)) continue;
      if (rule.range && (number < rule.range[0] || number > rule.range[1])) continue;
      best = Math.max(best, rule.strength);
    }
  }
  return best;
}

/** A program label for a master's, doctoral or professional degree. */
export function graduateProgram(label: string): boolean {
  return /(?:^|[\s,(])(?:MA|MS[A-Z]*|MBA|MPA|MPH|MFA|MEd|MArch|MLIS|MSW|MN|LLM|PhD|DNP|DPT|EdD|PharmD|JD|MD|DDS|Master|Doctor)(?=$|[\s,)'’])/i.test(label);
}
