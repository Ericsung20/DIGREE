import type {components} from '../contract/types';
import {IS_MOCK, supabase} from '../supabase';
import {getRemote, readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

export type PlannedSchedule = {term: string; selected: components['schemas']['SelectedBundle'][]};
export type StoredPlan = PlannedSchedule & {id: string; slot: number};
type PlanState = {plans: StoredPlan[]; loading: boolean; error: string | null};
const KEY = 'digree.planned';
const termKey = (term: string) => `${KEY}:${term}`;
const listKey = (term: string) => `${termKey(term)}:list`;
const stateKey = (term: string) => `${termKey(term)}:plans`;
const EMPTY: StoredPlan[] = [];
const LOADING: PlanState = {plans: EMPTY, loading: true, error: null};
export const PLAN_LIMIT = 3;
export const planLabel = (plan: StoredPlan) => `Plan ${plan.slot}`;
export class PlanLimitError extends Error {
  constructor() {super('You already have 3 saved plans. Delete one before saving another.');}
}
export function freePlanSlot(plans: Pick<StoredPlan, 'slot'>[]): number | null {
  return [1, 2, 3].find(slot => !plans.some(plan => plan.slot === slot)) ?? null;
}
function cachePlans(term: string, plans: StoredPlan[]) {
  const sorted = [...plans].sort((a, b) => a.slot - b.slot);
  if (IS_MOCK) writeStore(listKey(term), sorted);
  else setRemote<PlanState>(stateKey(term), {plans: sorted, loading: false, error: null});
}
type LegacyPlan = PlannedSchedule & {id?: string};
function legacyPlans(term: string, single: LegacyPlan | null, legacy: LegacyPlan | null): StoredPlan[] {
  const plan = single ?? (legacy?.term === term ? legacy : null);
  return plan ? [{...plan, id: plan.id ?? `legacy:${term}`, slot: 1}] : EMPTY;
}
function cachedPlans(term: string): StoredPlan[] {
  return IS_MOCK ? readStore<StoredPlan[] | null>(listKey(term), null)
    ?? legacyPlans(term, readStore(termKey(term), null), readStore(KEY, null))
    : getRemote(stateKey(term), LOADING).plans;
}
type Selected = PlannedSchedule['selected'][number];
type ScheduleItem = Pick<Selected, 'course_id' | 'bundle_id' | 'credits'> & {
  section_bundles: {courses: {code: string} | null; meetings: Selected['meetings']} | null;
};
export const SAVED_ITEMS = 'course_id, bundle_id, credits, section_bundles(courses(code), meetings(day, start_min, end_min, mode, building_id))';
export function readScheduleItems(items: unknown): Selected[] {
  return (items as ScheduleItem[]).map(({section_bundles: bundle, ...item}) => ({
    ...item, course_code: bundle?.courses?.code ?? item.course_id, meetings: bundle?.meetings ?? [],
  })).sort((a, b) => a.course_code.localeCompare(b.course_code));
}
async function loadPlans(term: string): Promise<StoredPlan[]> {
  const db = supabase();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) return [];
  const {data, error} = await db.from('saved_schedules')
    .select(`id, term, plan_slot, saved_schedule_items(${SAVED_ITEMS})`)
    .eq('user_id', auth.user.id).eq('term', term).eq('mode', 'planned').eq('state', 'active').order('plan_slot');
  if (error) throw error;
  return data.map(row => ({id: row.id, term: row.term, slot: row.plan_slot, selected: readScheduleItems(row.saved_schedule_items)}));
}
export async function refreshPlannedSchedules(term: string): Promise<void> {
  if (!IS_MOCK) cachePlans(term, await loadPlans(term));
}
export const usePlannedScheduleState: (term: string) => PlanState = IS_MOCK
  ? term => {
    const legacy = useStore<LegacyPlan | null>(KEY, null);
    const single = useStore<LegacyPlan | null>(termKey(term), null);
    const plans = useStore<StoredPlan[] | null>(listKey(term), null);
    return {plans: plans ?? legacyPlans(term, single, legacy), loading: false, error: null};
  }
  : term => useRemote(stateKey(term), LOADING, async () => {
    try {return {plans: term ? await loadPlans(term) : [], loading: false, error: null};}
    catch {return {plans: EMPTY, loading: false, error: 'Couldn’t load your saved plans. Reload to try again.'};}
  });
export function usePlannedSchedule(term: string, id?: string | null): StoredPlan | null {
  const {plans} = usePlannedScheduleState(term);
  return plans.find(plan => plan.id === id) ?? plans[0] ?? null;
}
export async function savePlannedSchedule(plan: PlannedSchedule, requestId: string): Promise<string> {
  const existing = cachedPlans(plan.term);
  const slot = freePlanSlot(existing);
  if (IS_MOCK) {
    if (!slot) throw new PlanLimitError();
    const id = crypto.randomUUID();
    cachePlans(plan.term, [...existing, {...plan, id, slot}]);
    return id;
  }
  const db = supabase();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) throw new Error('Sign in to save a schedule.');
  const items = plan.selected.map(({course_id, bundle_id, credits}) => ({course_id, bundle_id, credits}));
  const {data: id, error} = await db.rpc('save_schedule', {p_term: plan.term, p_items: items, p_request_id: requestId});
  if (error?.message?.includes('PLANS_FULL:')) {
    await refreshPlannedSchedules(plan.term).catch(() => {});
    throw new PlanLimitError();
  }
  if (error) throw error;
  if (typeof id !== 'string' || !id) throw new Error('The plan could not be confirmed as saved. Try again.');
  // A failed refresh must not turn a confirmed save into a retry/duplicate.
  try {await refreshPlannedSchedules(plan.term);}
  catch {cachePlans(plan.term, [...existing, {...plan, id, slot: slot ?? 1}]);}
  return id;
}
export async function deletePlannedSchedule(plan: StoredPlan): Promise<void> {
  if (!IS_MOCK) {
    const {error} = await supabase().rpc('archive_schedule', {p_schedule_id: plan.id});
    if (error) throw error;
  }
  cachePlans(plan.term, cachedPlans(plan.term).filter(item => item.id !== plan.id));
}
export async function removePlannedCourse(plan: StoredPlan, courseId: string): Promise<void> {
  const current = cachedPlans(plan.term).find(item => item.id === plan.id) ?? plan;
  const selected = current.selected.filter(item => item.course_id !== courseId);
  if (!selected.length) return deletePlannedSchedule(current);
  if (!IS_MOCK) {
    const {error} = await supabase().from('saved_schedule_items').delete().eq('schedule_id', plan.id).eq('course_id', courseId);
    if (error) throw error;
  }
  cachePlans(plan.term, cachedPlans(plan.term).map(item => item.id === plan.id ? {...item, selected} : item));
}
