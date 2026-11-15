import type {components} from '../contract/types';
import {readStore, useStore, writeStore} from './local-store';

export type PlannedSchedule = {term: string; selected: components['schemas']['SelectedBundle'][]};

const KEY = 'digree.planned';

// One planned schedule per browser in mock mode (saved_schedules with mode "planned" in the DB handoff).
// A plan is never a registration and is kept apart from self-reported enrollment.
export const usePlannedSchedule = () => useStore<PlannedSchedule | null>(KEY, null);
export const savePlannedSchedule = (plan: PlannedSchedule) => writeStore(KEY, plan);
export const deletePlannedSchedule = () => writeStore<PlannedSchedule | null>(KEY, null);

export function removePlannedCourse(courseId: string): void {
  const plan = readStore<PlannedSchedule | null>(KEY, null);
  if (!plan) return;
  const selected = plan.selected.filter((s) => s.course_id !== courseId);
  writeStore<PlannedSchedule | null>(KEY, selected.length ? {...plan, selected} : null);
}
