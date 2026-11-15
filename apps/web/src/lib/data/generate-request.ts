import type {components} from '../contract/types';
import fixture from '../../mocks/request.json';

export type GenerateRequest = components['schemas']['GenerateRequest'];

/**
 * Builds the optimizer request. Mock mode returns the shared fixture unchanged.
 * The real DB-backed adapter lands in F8; until then non-mock mode fails loudly
 * instead of sending guessed data.
 */
export function buildGenerateRequest(): GenerateRequest {
  if (process.env.DIGREE_MOCK !== '1') {
    throw new Error('buildGenerateRequest: only mock mode (DIGREE_MOCK=1) is implemented');
  }
  // JSON imports widen enum fields to string, so the cast is needed; the fixture is the contract's own example.
  return fixture as GenerateRequest;
}
