import type {components} from '../contract/types';
import fixture from '../../mocks/request.json';
import {BREADTH_OPTIONS} from '../breadth';
import {parseDigInputs, weightsFor} from '../dig-request';

export type GenerateRequest = components['schemas']['GenerateRequest'];
type Candidate = components['schemas']['CandidateCourse'];

/**
 * The mock optimizer request: the shared fixture, unchanged.
 * Requests built from real catalog rows come from buildGenerateRequestFromDb in lib/dig-server.ts.
 */
export function buildGenerateRequest(): GenerateRequest {
  // JSON imports widen enum fields to string, so the cast is needed; the fixture is the contract's own example.
  return fixture as GenerateRequest;
}

/** A local optimizer request built from the DIG form and synthetic breadth courses. */
export function buildSampleGenerateRequest(raw: unknown): GenerateRequest | {error: string} {
  const inputs = parseDigInputs(raw);
  if ('error' in inputs) return inputs;
  const body = structuredClone(fixture as GenerateRequest);
  const fixtureIds = new Set(body.courses.map((course) => course.course_id));
  if (inputs.required.some((id) => !fixtureIds.has(id))) return {error: 'That sample course has no sections. Choose a course with sections and dig again.'};
  const meetings: components['schemas']['Meeting'][] = [
    {day: 'TUE', start_min: 780, end_min: 830, mode: 'in_person', building_id: 'DELTA'},
    {day: 'THU', start_min: 780, end_min: 830, mode: 'in_person', building_id: 'DELTA'},
  ];
  const optional: Candidate[] = BREADTH_OPTIONS.map(({code}) => ({
    course_id: `demo-breadth-${code.toLowerCase()}`,
    course_code: `DEMO ${code} 101`,
    credit_options: [4],
    is_required: false,
    eligibility_status: 'eligible',
    already_completed: false,
    repeatable: false,
    requirement_fit: null,
    breadth: [code],
    grade_stats: null,
    section_bundles: [{bundle_id: `demo-${code.toLowerCase()}-A`, meetings, seat_status: 'open', instructor_score: null}],
  }));
  body.request_id = 'sample-dig';
  body.term = inputs.term;
  body.top_k = 5;
  body.constraints = {
    ...body.constraints,
    min_credits: inputs.minCredits,
    max_credits: inputs.maxCredits,
    earliest_start_min: inputs.earliest,
    latest_end_min: inputs.latest,
    blocked_days: inputs.blockedDays,
  };
  body.preferences = {weights: weightsFor(inputs.prefer ?? [], inputs.preferredBreadths), preferred_breadths: inputs.preferredBreadths ?? []};
  body.courses = [...body.courses.map((course) => ({...course, is_required: inputs.required.includes(course.course_id), breadth: null})), ...optional];
  return body;
}
