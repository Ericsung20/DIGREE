import {readFileSync} from 'node:fs';
import {afterEach, expect, test, vi} from 'vitest';
import {assertNoUserData, callOptimizer, generateSchedules} from './optimizer';
import {buildGenerateRequest} from './data/generate-request';

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
