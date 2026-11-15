import {readFileSync} from 'node:fs';
import {afterEach, expect, test, vi} from 'vitest';
import {buildGenerateRequest} from './generate-request';

afterEach(() => vi.unstubAllEnvs());

test('mock request is identical to the locked fixture', () => {
  vi.stubEnv('DIGREE_MOCK', '1');
  const original = JSON.parse(readFileSync(new URL('../../../../../fixtures/request.json', import.meta.url), 'utf8'));
  expect(buildGenerateRequest()).toEqual(original);
});

test('mock request carries no user identifiers', () => {
  vi.stubEnv('DIGREE_MOCK', '1');
  expect(JSON.stringify(buildGenerateRequest())).not.toMatch(/user_id|email|gpa/i);
});
