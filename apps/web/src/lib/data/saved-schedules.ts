import type {components} from '../contract/types';
import {IS_MOCK, supabase} from '../supabase';
import {readStore, setRemote, useRemote, useStore, writeStore} from './local-store';

export type PlannedSchedule = {term: string; selected: components['schemas']['SelectedBundle'][]};

const KEY = 'digree.planned';
const PLAN_NAME = 'DIG plan · ';
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

async function loadPlan(): Promise<StoredPlan | null> {
  const db = supabase();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) return null;
  const {data, error} = await db.from('saved_schedules')
    .select(`id, term, saved_schedule_items!inner(${SAVED_ITEMS})`)
    .eq('user_id', auth.user.id).eq('mode', 'planned').like('name', `${PLAN_NAME}%`)
    .order('name', {ascending: false}).order('id').limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {id: data.id, term: data.term, selected: readScheduleItems(data.saved_schedule_items)};
}

export const usePlannedSchedule: () => StoredPlan | null = IS_MOCK ? () => useStore(KEY, null) : () => useRemote(KEY, null, loadPlan);

export async function savePlannedSchedule(plan: PlannedSchedule, requestId: string): Promise<void> {
  if (IS_MOCK) return writeStore(KEY, plan);
  const db = supabase();
  const {data: auth} = await db.auth.getUser();
  if (!auth.user) throw new Error('Sign in to save a schedule.');
  const owner = auth.user.id;
  const id = crypto.randomUUID();
  const name = `${PLAN_NAME}${new Date().toISOString()} · ${id}`;
  const {error} = await db.from('saved_schedules').insert({
    id, user_id: owner, term: plan.term, mode: 'planned', name, source_request_id: requestId,
  });
  if (error) throw error;

  const items = plan.selected.map(({course_id, bundle_id, credits}) => ({schedule_id: id, term: plan.term, course_id, bundle_id, credits}));
  const inserted = await db.from('saved_schedule_items').insert(items);
  if (inserted.error) {
    await db.from('saved_schedules').delete().eq('id', id).eq('user_id', owner);
    throw inserted.error;
  }
  // Publish the complete plan before retiring earlier saves for this term.
  const removed = await db.from('saved_schedules').delete().eq('user_id', owner).eq('term', plan.term)
    .eq('mode', 'planned').like('name', `${PLAN_NAME}%`).lt('name', name);
  if (removed.error) {
    await db.from('saved_schedules').delete().eq('id', id).eq('user_id', owner);
    throw removed.error;
  }
  setRemote(KEY, {...plan, id});
}

export async function deletePlannedSchedule(plan: StoredPlan): Promise<void> {
  if (IS_MOCK) return writeStore(KEY, null);
  if (!plan.id) return;
  const {error} = await supabase().from('saved_schedules').delete().eq('id', plan.id);
  if (error) throw error;
  setRemote(KEY, null);
  try {
    setRemote(KEY, await loadPlan());
  } catch (error) {
    console.warn('Loading the next plan failed', error);
  }
}

export async function removePlannedCourse(plan: StoredPlan, courseId: string): Promise<void> {
  if (IS_MOCK) plan = readStore<PlannedSchedule | null>(KEY, null) ?? plan;
  const selected = plan.selected.filter((s) => s.course_id !== courseId);
  if (!selected.length) return deletePlannedSchedule(plan);
  if (IS_MOCK) return writeStore(KEY, {...plan, selected});
  if (!plan.id) return;
  const {error} = await supabase().from('saved_schedule_items').delete().eq('schedule_id', plan.id).eq('course_id', courseId);
  if (error) throw error;
  setRemote(KEY, {...plan, selected});
}
