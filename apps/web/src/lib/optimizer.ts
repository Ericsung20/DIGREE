// Server-only: called from the /api/dig/generate route handler, never from the browser.
import type {components} from './contract/types';
import expected from '../mocks/expected.json';
import {buildGenerateRequest, type GenerateRequest} from './data/generate-request';

export type GenerateResponse = components['schemas']['GenerateResponse'];
export type ScheduleResult = components['schemas']['ScheduleResult'];

/** Each failure mode stays distinct so the UI can explain it differently. */
export type GenerateOutcome =
  | {kind: 'ok'; data: GenerateResponse; request?: GenerateRequest}
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

export async function callOptimizer(body: GenerateRequest): Promise<GenerateOutcome> {
  assertNoUserData(body);
  let res: Response;
  try {
    res = await fetch(`${process.env.OPTIMIZER_URL}/v1/schedules/generate`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
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
  const message: string = (await res.json().catch(() => null))?.error?.message ?? `Optimizer returned ${res.status}`;
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
  if (usesFixtureRequest()) {
    body = buildGenerateRequest();
  } else {
    // Loaded on demand: it reads cookies, which only exist inside a Next.js request.
    const {buildGenerateRequestFromDb} = await import('./dig-server');
    try {
      const built = await buildGenerateRequestFromDb(rawInputs);
      if ('error' in built) return {kind: 'validation', message: built.error};
      body = built;
    } catch (error) {
      console.error('Building the optimizer request failed', error);
      return {kind: 'unavailable', message: 'The course catalog could not be loaded'};
    }
  }
  // The request rides along so the route can work out walking details from the same edges the optimizer saw.
  const withRequest = (out: GenerateOutcome): GenerateOutcome => (out.kind === 'ok' ? {...out, request: body} : out);
  if (process.env.DIGREE_MOCK === '1') {
    assertNoUserData(body);
    return withRequest(mockOutcome(mockVariant));
  }
  return withRequest(await callOptimizer(body));
}
