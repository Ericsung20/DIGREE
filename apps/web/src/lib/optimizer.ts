// Server-only: called from the /api/dig/generate route handler, never from the browser.
import type {components} from './contract/types';
import expected from '../mocks/expected.json';
import {buildGenerateRequest, type GenerateRequest} from './data/generate-request';

export type GenerateResponse = components['schemas']['GenerateResponse'];
export type ScheduleResult = components['schemas']['ScheduleResult'];

/** Each failure mode stays distinct so the UI can explain it differently. */
export type GenerateOutcome =
  | {kind: 'ok'; data: GenerateResponse}
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
  if (res.status === 200) return {kind: 'ok', data: (await res.json()) as GenerateResponse};
  const message: string = (await res.json().catch(() => null))?.error?.message ?? `Optimizer returned ${res.status}`;
  return {kind: res.status === 422 ? 'validation' : 'unavailable', message};
}

// Mock switch values, so empty and error screens can be checked without an optimizer.
function mockOutcome(variant?: string): GenerateOutcome {
  const data = expected as GenerateResponse;
  switch (variant) {
    case 'empty':
      return {kind: 'ok', data: {...data, results: [], diagnostics: {...data.diagnostics, no_results_reasons: ['Mock: required courses overlap in time.']}}};
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

export async function generateSchedules(mockVariant?: string): Promise<GenerateOutcome> {
  let body: GenerateRequest;
  try {
    body = buildGenerateRequest();
  } catch (e) {
    return {kind: 'unavailable', message: e instanceof Error ? e.message : 'Request could not be built'};
  }
  if (process.env.DIGREE_MOCK === '1') {
    assertNoUserData(body);
    return mockOutcome(mockVariant);
  }
  return callOptimizer(body);
}
