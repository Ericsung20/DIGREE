import {useStore, writeStore} from './local-store';
import {scheduleUrl, type ScheduleView} from '../schedule-view';

export type ScheduleLocation = {term: string; view: ScheduleView; plan?: string};
export const SCHEDULE_LOCATION_KEY = 'digree.schedule.location';
export const useScheduleLocation = () => useStore<ScheduleLocation | null>(SCHEDULE_LOCATION_KEY, null);
export function rememberSchedule(location: ScheduleLocation): void {
  // A blocked device store must not turn a confirmed DB save into a failed save.
  try {writeStore(SCHEDULE_LOCATION_KEY, location);} catch { /* The URL still carries the saved plan. */ }
}
export const rememberedScheduleUrl = (location: ScheduleLocation | null) => location ? scheduleUrl(location.view, location.term, null, location.plan) : '/';
