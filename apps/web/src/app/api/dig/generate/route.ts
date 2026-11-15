import type {DigResponse} from '@/lib/dig-view';
import {walkChecks} from '@/lib/dig-view';
import {generateSchedules, usesFixtureRequest} from '@/lib/optimizer';

const STATUS = {validation: 422, unavailable: 503, network: 502} as const;

// BFF endpoint for the DIG screens. `?mock=empty|422|503|network` only has an effect when DIGREE_MOCK=1.
export async function POST(request: Request) {
  const inputs: unknown = await request.json().catch(() => null); // validated in generateSchedules
  const out = await generateSchedules(new URL(request.url).searchParams.get('mock') ?? undefined, inputs);
  if (out.kind !== 'ok') return Response.json({error: {code: out.kind, message: out.message}}, {status: STATUS[out.kind]});
  // The optimizer reports walking per week. The cards show the longest single walk, so it is measured here.
  const body: DigResponse = {...out.data, walks: walkChecks(out.data.results, out.request?.walking_edges ?? []), sample: usesFixtureRequest()};
  return Response.json(body);
}
