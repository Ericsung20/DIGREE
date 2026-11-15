import {generateSchedules} from '@/lib/optimizer';

const STATUS = {validation: 422, unavailable: 503, network: 502} as const;

// BFF endpoint for the DIG screen. `?mock=empty|422|503|network` only has an effect when DIGREE_MOCK=1.
export async function POST(request: Request) {
  const inputs: unknown = await request.json().catch(() => null); // validated in generateSchedules
  const out = await generateSchedules(new URL(request.url).searchParams.get('mock') ?? undefined, inputs);
  if (out.kind === 'ok') return Response.json(out.data);
  return Response.json({error: {code: out.kind, message: out.message}}, {status: STATUS[out.kind]});
}
