// Pure parts of the DIG request: input validation and the mapping from catalog rows to the
// optimizer contract. No database, no cookies, so it runs in tests as is.
import type {components} from './contract/types';
import {DAYS} from './time';

type S = components['schemas'];
export type GenerateRequest = S['GenerateRequest'];
type Day = S['Day'];

/** What the DIG form starts with. `sample` is true when results come from the shared fixture. */
export type DigDefaults = {
  term: string;
  termLabel: string;
  terms: {id: string; label: string}[];
  minCredits: number;
  maxCredits: number;
  earliest: number;
  latest: number;
  courses: {id: string; code: string; credits: string; required: boolean}[];
  sample: boolean;
  hasSections?: boolean;
};

export type DigPreference = 'balanced' | 'walking' | 'days';
export type DigInputs = {term: string; minCredits: number; maxCredits: number; required: string[]; earliest: number; latest: number; blockedDays: Day[]; preference?: DigPreference; related?: boolean};

const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...new Set(v as string[])] : null);

/** Validates the form body posted by the browser. Ranges follow contracts/openapi.yaml. */
export function parseDigInputs(raw: unknown): DigInputs | {error: string} {
  if (raw === null || typeof raw !== 'object') return {error: 'Missing schedule options.'};
  const r = raw as Record<string, unknown>;
  const minCredits = int(r.min_credits, 0, 40);
  const maxCredits = int(r.max_credits, 0, 40);
  const earliest = int(r.earliest, 0, 1439);
  const latest = int(r.latest, 1, 1440);
  const required = strings(r.required);
  const blocked = strings(r.blocked);
  if (typeof r.term !== 'string' || !r.term) return {error: 'Pick a term.'};
  if (minCredits === null || maxCredits === null) return {error: 'Credits must be whole numbers from 0 to 40.'};
  if (minCredits > maxCredits) return {error: "Minimum credits can't exceed maximum."};
  if (earliest === null || latest === null || earliest >= latest) return {error: 'Earliest start must be before latest end.'};
  if (!required || !blocked || !blocked.every((d) => (DAYS as string[]).includes(d))) return {error: 'Invalid course or day selection.'};
  const preference = r.preference;
  if (preference !== undefined && preference !== 'balanced' && preference !== 'walking' && preference !== 'days') return {error: 'Choose a valid scheduling preference.'};
  return {term: r.term, minCredits, maxCredits, required, earliest, latest, blockedDays: blocked as Day[],
    ...(preference !== undefined ? {preference} : {}), ...(r.related === true ? {related: true} : {})};
}

/** Catalog rows for the candidate courses, as read from the database. */
export type CatalogRows = {
  courses: {id: string; code: string; credit_options: number[]; repeatable: boolean; eligibility?: S['CandidateCourse']['eligibility_status']}[];
  bundles: {course_id: string; bundle_id: string; seat_status: S['SectionBundle']['seat_status']; instructor_score: number | null}[];
  meetings: {course_id: string; bundle_id: string; day: Day; start_min: number; end_min: number; mode: S['Mode']; building_id: string | null}[];
  stats: {course_id: string; a_ab_rate: number; sample_size: number}[];
  edges: {from_building_id: string; to_building_id: string; minutes: number; bidirectional: boolean}[];
  /** Ids of courses the user has marked completed. Only the boolean derived from this is sent. */
  completedCourseIds: string[];
};

/**
 * Builds the optimizer request. Nothing about the user is included: no id, email, grades or DARS data.
 * Unknown stays unknown: eligibility is "unknown", missing scores and stats are null, and no walking
 * time is invented when the catalog has none.
 */
export function toGenerateRequest(inputs: DigInputs, rows: CatalogRows, requestId: string): GenerateRequest {
  return {
    contract_version: '1.0',
    request_id: requestId,
    term: inputs.term,
    top_k: 5,
    constraints: {
      min_credits: inputs.minCredits,
      max_credits: inputs.maxCredits,
      earliest_start_min: inputs.earliest,
      latest_end_min: inputs.latest,
      blocked_days: inputs.blockedDays,
      walking_buffer_min: 3, // fixed, same as the shared fixture; not a user input
      max_walk_per_transition_min: null,
      exclude_full_sections: false,
    },
    preferences: {weights: {walking: inputs.preference === 'walking' ? 3 : 1, idle_gap: 1, campus_days: inputs.preference === 'days' ? 3 : 1, grade_outcomes: 0, degree_fit: 0, instructor: 0}},
    courses: rows.courses.map((c) => {
      const stat = rows.stats.find((s) => s.course_id === c.id);
      return {
        course_id: c.id,
        course_code: c.code,
        credit_options: c.credit_options,
        is_required: inputs.required.includes(c.id),
        eligibility_status: c.eligibility ?? 'unknown',
        already_completed: rows.completedCourseIds.includes(c.id),
        repeatable: c.repeatable,
        requirement_fit: null,
        grade_stats: stat ? {a_ab_rate: Number(stat.a_ab_rate), sample_size: stat.sample_size} : null,
        section_bundles: rows.bundles
          .filter((b) => b.course_id === c.id)
          .map((b) => ({
            bundle_id: b.bundle_id,
            seat_status: b.seat_status,
            instructor_score: b.instructor_score === null ? null : Number(b.instructor_score),
            meetings: rows.meetings
              .filter((m) => m.course_id === c.id && m.bundle_id === b.bundle_id)
              .map((m) => ({day: m.day, start_min: m.start_min, end_min: m.end_min, mode: m.mode, building_id: m.building_id})),
          })),
      };
    }),
    walking_edges: rows.edges.map((e) => ({from_building_id: e.from_building_id, to_building_id: e.to_building_id, minutes: e.minutes, bidirectional: e.bidirectional})),
  };
}
