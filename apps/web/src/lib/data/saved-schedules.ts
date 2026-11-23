import type {components} from '../contract/types';
import {IS_MOCK, supabase} from '../supabase';
import {readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

export type PlannedSchedule = {term: string; selected: components['schemas']['SelectedBundle'][]};

const KEY = 'digree.planned';
const termKey = (term: string) => `${KEY}:${term}`;
type StoredPlan = PlannedSchedule & {id?: string};
type Selected = PlannedSchedule['selected'][number];
type ScheduleItem = Pick<Selected, 'course_id' | 'bundle_id' | 'credits'> & {
  section_bundles: {courses: {code: string} | null; meetings: Selected['meetings']} | null;
};
export const SAVED_ITEMS = 'course_id, bundle_id, credits, section_bundles(courses(code), meetings(day, start_min, end_min, mode, building_id))';

export function readScheduleItems(items: unknown): Selected[] {
  return (items as ScheduleItem[]).map(({section_bundles: bundle, ...item}) => ({
    ...item,
    course_code: bundle?.courses?.code ?? item.course_id,
    meetings: bundle?.meetings ?? [],
  })).sort((a, b) => a.course_code.localeCompare(b.course_code));
}

async function loadPlan(term: string): Promise<StoredPlan | null> {
  const db = supabase();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) return null;
  const {data, error} = await db.from('saved_schedules')
    .select(`id, term, saved_schedule_items!inner(${SAVED_ITEMS})`)
    .eq('user_id', auth.user.id).eq('term', term).eq('mode', 'planned').eq('state', 'active').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {id: data.id, term: data.term, selected: readScheduleItems(data.saved_schedule_items)};
}

export const usePlannedSchedule: (term: string) => StoredPlan | null = IS_MOCK
  ? (term) => {
    const legacy = useStore<StoredPlan | null>(KEY, null);
    const plan = useStore<StoredPlan | null>(termKey(term), null);
    return plan ?? (legacy?.term === term ? legacy : null);
  }
  : (term) => useRemote(termKey(term), null, () => term ? loadPlan(term) : Promise.resolve(null));

export async function savePlannedSchedule(plan: PlannedSchedule, requestId: string): Promise<void> {
  if (IS_MOCK) return writeStore(termKey(plan.term), plan);
  const db = supabase();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) throw new Error('Sign in to save a schedule.');
  const items = plan.selected.map(({course_id, bundle_id, credits}) => ({course_id, bundle_id, credits}));
  const {data: id, error} = await db.rpc('save_schedule', {p_term: plan.term, p_items: items, p_request_id: requestId});
  if (error) throw error;
  setRemote(termKey(plan.term), {...plan, id});
}

export async function deletePlannedSchedule(plan: StoredPlan): Promise<void> {
  if (IS_MOCK) {
    if (readStore<StoredPlan | null>(KEY, null)?.term === plan.term) writeStore(KEY, null);
    return writeStore(termKey(plan.term), null);
  }
  if (!plan.id) return;
  const {error} = await supabase().from('saved_schedules').delete().eq('id', plan.id);
  if (error) throw error;
  setRemote(termKey(plan.term), null);
}

export async function removePlannedCourse(plan: StoredPlan, courseId: string): Promise<void> {
  if (IS_MOCK) plan = readStore(termKey(plan.term), plan);
  const selected = plan.selected.filter((s) => s.course_id !== courseId);
  if (!selected.length) return deletePlannedSchedule(plan);
  if (IS_MOCK) return writeStore(termKey(plan.term), {...plan, selected});
  if (!plan.id) return;
  const {error} = await supabase().from('saved_schedule_items').delete().eq('schedule_id', plan.id).eq('course_id', courseId);
  if (error) throw error;
  setRemote(termKey(plan.term), {...plan, selected});
}
