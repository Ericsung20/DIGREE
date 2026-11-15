import type {components} from './contract/types';

type Day = components['schemas']['Day'];

export const DAYS: Day[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Minutes after campus-local midnight to a 12-hour label: 600 -> "10:00 AM". */
export function minToLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(min % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** Sort comparator: weekday order (MON first), then start time. */
export function byDayThenStart(a: {day: Day; start_min: number}, b: {day: Day; start_min: number}): number {
  return DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start_min - b.start_min;
}
