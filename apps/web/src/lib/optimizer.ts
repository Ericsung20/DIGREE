// Server-only: called from the /api/dig/generate route handler, never from the browser.
import type {components} from './contract/types';
import expected from '../mocks/expected.json';
import {buildGenerateRequest, buildSampleGenerateRequest, type GenerateRequest} from './data/generate-request';

export type GenerateResponse = components['schemas']['GenerateResponse'];
export type ScheduleResult = components['schemas']['ScheduleResult'];

/** Each failure mode stays distinct so the UI can explain it differently. */
export type GenerateOutcome =
  | {kind: 'ok'; data: GenerateResponse; request?: GenerateRequest; majorCourses?: Record<string, string[]>; majorPreference?: {target: number; relaxed: boolean; searchLimited: boolean}}
  | {kind: 'validation'; message: string} // optimizer 422
  | {kind: 'unavailable'; message: string} // optimizer 503 or any other non-200
  | {kind: 'network'; message: string}; // optimizer unreachable

const FORBIDDEN_KEY = /^(user_?id|email|net_?id|gpa|password|dars.*|chat.*)$/i;

/** Guard: the optimizer must never receive user identifiers, grades, DARS data or chat text. */
export function assertNoUserData(value: unknown, path = 'request'): void {
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoUserData(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`Refusing to send "${path}.${key}" to the optimizer`);
    assertNoUserData(v, `${path}.${key}`);
  }
}

export async function callOptimizer(body: GenerateRequest, timeoutMs?: number): Promise<GenerateOutcome> {
  assertNoUserData(body);
  let res: Response;
  try {
    res = await fetch(`${process.env.OPTIMIZER_URL}/v1/schedules/generate`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? (body.preferences.catalog_search ? 120_000 : 15_000)),
    });
  } catch {
    return {kind: 'network', message: 'Optimizer could not be reached'};
  }
  if (res.status === 200) {
    const data = (await res.json().catch(() => null)) as GenerateResponse | null;
    return data && data.term === body.term && Array.isArray(data.results) && data.diagnostics
      ? {kind: 'ok', data}
      : {kind: 'unavailable', message: 'Optimizer returned an invalid response'};
  }
  const error = (await res.json().catch(() => null))?.error;
  const message: string = error?.message ?? `Optimizer returned ${res.status}`;
  if (res.status === 422 && Array.isArray(error?.details) && error.details.length) {
    const details = error.details.filter((detail: unknown): detail is string => typeof detail === 'string');
    console.warn('Optimizer rejected the DIG request', {requestId: body.request_id, details});
    if (details.some((detail: string) => /^(?:courses\[\d+\]\.(?:breadth|is_major_course)|constraints\.(?:max|min)_major_courses|preferences\.(?:preferred_breadths|catalog_search|weights\.(?:breadth|major_balance))): Extra inputs are not permitted/.test(detail))) {
      return {kind: 'unavailable', message: 'The DIG server is running an older version.'};
    }
  }
  return {kind: res.status === 422 ? 'validation' : 'unavailable', message};
}

// Mock switch values, so empty and error screens can be checked without an optimizer.
function mockOutcome(variant?: string): GenerateOutcome {
  const data = expected as GenerateResponse;
  switch (variant) {
    case 'empty':
      return {kind: 'ok', data: {...data, results: [], diagnostics: {...data.diagnostics, no_results_reasons: ['outside_time_window', 'time_overlap']}}};
    case '422':
      return {kind: 'validation', message: 'Mock validation error'};
    case '503':
      return {kind: 'unavailable', message: 'Mock optimizer outage'};
    case 'network':
      return {kind: 'network', message: 'Mock network failure'};
    default:
      return {kind: 'ok', data};
  }
}

/** True when the request is the shared fixture rather than rows from the database. */
export const usesFixtureRequest = () => process.env.DIGREE_MOCK === '1' || process.env.NEXT_PUBLIC_DIGREE_DATA !== 'supabase';

export async function generateSchedules(mockVariant?: string, rawInputs?: unknown): Promise<GenerateOutcome> {
  let body: GenerateRequest;
  let majorCourses: Record<string, string[]> | undefined;
  if (usesFixtureRequest()) {
    const built = process.env.DIGREE_MOCK === '1' || rawInputs === undefined ? buildGenerateRequest() : buildSampleGenerateRequest(rawInputs);
    if ('error' in built) return {kind: 'validation', message: built.error};
    body = built;
  } else {
    // Loaded on demand: it reads cookies, which only exist inside a Next.js request.
    const {buildGenerateContextFromDb} = await import('./dig-server');
    try {
      const built = await buildGenerateContextFromDb(rawInputs);
      if ('error' in built) return {kind: 'validation', message: built.error};
      body = built.request;
      majorCourses = built.majorCourses;
    } catch (error) {
      console.error('Building the optimizer request failed', error);
      return {kind: 'unavailable', message: 'The course catalog could not be loaded'};
    }
  }
  // The request rides along so the route can work out walking details from the same edges the optimizer saw.
  const withRequest = (out: GenerateOutcome): GenerateOutcome => (out.kind === 'ok' ? {...out, request: body, majorCourses} : out);
  if (process.env.DIGREE_MOCK === '1') {
    assertNoUserData(body);
    return withRequest(mockOutcome(mockVariant));
  }
  return withRequest(await generateWithMajorTarget(body));
}

/** Try the requested count first; never silently mix relaxed results with exact matches. */
export async function generateWithMajorTarget(body: GenerateRequest): Promise<GenerateOutcome> {
  const target = body.constraints.max_major_courses;
  if (target == null) return callOptimizer(body);
  const deadline = Date.now() + (body.preferences.catalog_search ? 120_000 : 30_000);
  const exact = {...body, constraints: {...body.constraints, min_major_courses: target}};
  const first = await callOptimizer(exact, Math.max(1, deadline - Date.now()));
  if (first.kind !== 'ok') return first;
  if (first.data.results.length || target === 0) return {...first, majorPreference: {target, relaxed: false, searchLimited: first.data.diagnostics.search_truncated}};
  const fallback = await callOptimizer({...body, constraints: {...body.constraints, min_major_courses: 0}}, Math.max(1, deadline - Date.now()));
  return fallback.kind === 'ok' ? {...fallback, majorPreference: {target, relaxed: true, searchLimited: first.data.diagnostics.search_truncated}} : fallback;
}
