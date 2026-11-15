import type {components} from '../contract/types';
import fixture from '../../mocks/request.json';

export type GenerateRequest = components['schemas']['GenerateRequest'];

/**
 * The mock optimizer request: the shared fixture, unchanged.
 * Requests built from real catalog rows come from buildGenerateRequestFromDb in lib/dig-server.ts.
 */
export function buildGenerateRequest(): GenerateRequest {
  // JSON imports widen enum fields to string, so the cast is needed; the fixture is the contract's own example.
  return fixture as GenerateRequest;
}
