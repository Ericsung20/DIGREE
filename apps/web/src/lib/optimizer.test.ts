import {readFileSync} from 'node:fs';
import {afterEach, expect, test, vi} from 'vitest';
import {assertNoUserData, callOptimizer, generateSchedules} from './optimizer';
import {buildGenerateRequest, buildSampleGenerateRequest} from './data/generate-request';
import {DEFAULT_CONDITIONS, toDigBody} from './dig-view';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url), 'utf8'));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test('mock mode returns the locked expected fixture: ranks 1/2/3 walk 0/12/36', async () => {
  vi.stubEnv('DIGREE_MOCK', '1');
  const out = await generateSchedules();
  if (out.kind !== 'ok') throw new Error('expected ok');
  expect(out.data).toEqual(fixture('expected.json'));
  expect(out.data.results.map((r) => [r.rank, r.metrics.walking_minutes_weekly, r.score.toFixed(2)])).toEqual([
    [1, 0, '100.00'],
    [2, 12, '67.03'],
    [3, 36, '30.12'],
  ]);
});

test('mock switch yields empty and each error kind', async () => {
  vi.stubEnv('DIGREE_MOCK', '1');
  const empty = await generateSchedules('empty');
  expect(empty.kind === 'ok' && empty.data.results.length === 0 && empty.data.diagnostics.no_results_reasons.length > 0).toBe(true);
  expect((await generateSchedules('422')).kind).toBe('validation');
  expect((await generateSchedules('503')).kind).toBe('unavailable');
  expect((await generateSchedules('network')).kind).toBe('network');
});

test('live sample request carries selected breadth and the DIG constraints', () => {
  const inputs = toDigBody('2027FA', {...DEFAULT_CONDITIONS, breadths: ['H']}, ['cs400', 'math234', 'stat240'], 10);
  const built = buildSampleGenerateRequest(inputs);
  if ('error' in built) throw new Error(built.error);
  expect(built.term).toBe('2027FA');
  expect(built.constraints).toMatchObject({min_credits: 13, max_credits: 14, blocked_days: ['FRI', 'SAT', 'SUN']});
  expect(built.preferences).toMatchObject({preferred_breadths: ['H'], weights: {breadth: 1}});
  expect(built.courses.find((course) => course.course_id === 'demo-breadth-h')?.breadth).toEqual(['H']);
});

// Opt-in: set OPTIMIZER_LIVE_URL=http://127.0.0.1:8000 to compare the running optimizer with the locked fixture.
test.skipIf(!process.env.OPTIMIZER_LIVE_URL)('live optimizer answers the fixture request with the expected fixture', async () => {
  vi.stubEnv('DIGREE_MOCK', '0');
  vi.stubEnv('OPTIMIZER_URL', process.env.OPTIMIZER_LIVE_URL!);
  const out = await generateSchedules(); // data source is mock here, so the request is the fixture
  if (out.kind !== 'ok') throw new Error(`expected ok, got ${out.kind}: ${out.message}`);
  expect(out.data).toEqual(fixture('expected.json'));
  expect(out.data.results.map((r) => [r.rank, r.metrics.walking_minutes_weekly, r.selected.map((s) => s.bundle_id)])).toEqual([
    [1, 0, ['cs400-B', 'math234-B', 'stat240-A']],
    [2, 12, ['cs400-A', 'math234-A', 'stat240-A']],
    [3, 36, ['cs400-A', 'math234-B', 'stat240-A']],
  ]);
});

test('guard rejects user data anywhere in the body and accepts the fixture', () => {
  expect(() => assertNoUserData(fixture('request.json'))).not.toThrow();
  expect(() => assertNoUserData({courses: [{course_id: 'x', user_id: 1}]})).toThrow(/user_id/);
  expect(() => assertNoUserData({email: 'a@b.c'})).toThrow(/email/);
  expect(() => assertNoUserData({meta: {GPA: 3.5}})).toThrow(/GPA/);
});

test('callOptimizer maps 200 / 422 / 503 / network to distinct kinds and never sends user data', async () => {
  vi.stubEnv('DIGREE_MOCK', '1');
  vi.stubEnv('OPTIMIZER_URL', 'http://optimizer.test');
  const body = buildGenerateRequest();
  const reply = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), {status}));

  const ok = reply(200, fixture('expected.json'));
  vi.stubGlobal('fetch', ok);
  expect((await callOptimizer(body)).kind).toBe('ok');
  expect(ok).toHaveBeenCalledWith('http://optimizer.test/v1/schedules/generate', expect.objectContaining({method: 'POST'}));

  vi.stubGlobal('fetch', reply(422, {error: {code: 'bad', message: 'weights are all zero'}}));
  expect(await callOptimizer(body)).toEqual({kind: 'validation', message: 'weights are all zero'});

  vi.stubGlobal('fetch', reply(503, {error: {code: 'down', message: 'busy'}}));
  expect((await callOptimizer(body)).kind).toBe('unavailable');

  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
  expect((await callOptimizer(body)).kind).toBe('network');

  const never = reply(200, {});
  vi.stubGlobal('fetch', never);
  await expect(callOptimizer({...body, email: 'a@b.c'} as typeof body)).rejects.toThrow(/email/);
  expect(never).not.toHaveBeenCalled();
});
