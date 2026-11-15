import {DEFAULT_CONDITIONS, toDigBody, type DigConditions, type DigResponse} from '../dig-view';
import {currentTermOf, type Term} from './catalog';
import {setRemote, getRemote, useRemote, useStore, writeStore} from './local-store';

// The DIG flow spans three screens (conditions, recommendations, preview). Conditions are kept on
// the device so they are still there next time; one run of the optimizer lives in memory only.

const CONDITIONS = 'digree.dig.conditions';

/** DIG plans the term after the current one unless the link names another. */
export function digTerm(terms: Term[], requested: string | null): string {
  const current = terms.findIndex((term) => term.id === currentTermOf(terms));
  return terms.find((term) => term.id === requested)?.id ?? (current >= 0 ? terms[current + 1]?.id : undefined) ?? terms.at(-1)?.id ?? '';
}

export function useDigConditions(): DigConditions {
  const stored = useStore<DigConditions>(CONDITIONS, DEFAULT_CONDITIONS);
  // A value saved by an older build may be missing fields; start over rather than crash.
  return Array.isArray(stored?.days) && stored.days.length === 5 && stored.prefer && Number.isInteger(stored.credits) ? stored : DEFAULT_CONDITIONS;
}
export const saveDigConditions = (conditions: DigConditions) => writeStore(CONDITIONS, conditions);

export type MustTake = {id: string; code: string; credits: number};
export type DigFailure = {kind: 'validation' | 'unavailable' | 'network'; message: string | null};
export type DigRun = {
  id: number;
  term: string;
  termLabel: string;
  conditions: DigConditions;
  mustTake: MustTake[];
  /** `?mock=` switch for previewing the empty and error states with DIGREE_MOCK=1. */
  mock: string | null;
  digging: boolean;
  data: DigResponse | null;
  failure: DigFailure | null;
  /** Which card of the deck is on top, so coming back from the preview lands on the same option. */
  index: number;
};

const RUN = 'dig.run';
const MIN_DIG_MS = 2100; // long enough for the three layers of the digging animation to finish
let controller: AbortController | null = null;
let sequence = 0;

const currentRun = () => getRemote<DigRun | null>(RUN, null);
export const useDigRun = (): DigRun | null => useRemote<DigRun | null>(RUN, null, async () => currentRun());
export function setDigIndex(index: number): void {
  const run = currentRun();
  if (run && run.index !== index) setRemote(RUN, {...run, index});
}

/** Starts a run and returns at once; the screens follow it through `useDigRun`. */
export function startDig(input: Pick<DigRun, 'term' | 'termLabel' | 'conditions' | 'mustTake' | 'mock'>): void {
  controller?.abort();
  const abort = (controller = new AbortController());
  const run: DigRun = {...input, id: ++sequence, digging: true, data: null, failure: null, index: 0};
  setRemote(RUN, run);
  const started = Date.now();
  const finish = (result: Pick<DigRun, 'data' | 'failure'>) => {
    window.setTimeout(() => {
      if (currentRun()?.id === run.id) setRemote(RUN, {...run, ...result, digging: false});
    }, Math.max(0, MIN_DIG_MS - (Date.now() - started)));
  };
  const body = toDigBody(run.term, run.conditions, run.mustTake.map((course) => course.id), run.mustTake.reduce((total, course) => total + course.credits, 0));
  fetch(`/api/dig/generate${run.mock ? `?mock=${encodeURIComponent(run.mock)}` : ''}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: abort.signal})
    .then(async (response) => {
      if (response.ok) return finish({data: (await response.json()) as DigResponse, failure: null});
      const message = ((await response.json().catch(() => null)) as {error?: {message?: string}} | null)?.error?.message ?? null;
      // A 422 says what to fix (ours or the optimizer's), so its message is shown.
      finish({data: null, failure: response.status === 422 ? {kind: 'validation', message} : {kind: response.status === 503 ? 'unavailable' : 'network', message: null}});
    })
    .catch(() => {
      if (!abort.signal.aborted) finish({data: null, failure: {kind: 'network', message: null}});
    });
}

/** Cancel while digging: stop waiting and forget the run. The conditions stay saved. */
export function cancelDig(): void {
  controller?.abort();
  controller = null;
  setRemote(RUN, null);
}
