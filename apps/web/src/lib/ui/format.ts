import type {Meeting} from '../data/catalog';
import {DAYS} from '../time';
import {friendlyCourseCode} from '../course-identity';

type Slot = Pick<Meeting, 'day' | 'start_min' | 'end_min'>;

/** The five columns every week grid shows. */
export const WEEKDAYS = DAYS.slice(0, 5);
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F'];
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_TINY = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];

export const dayIndex = (day: string) => (DAYS as string[]).indexOf(day);

/** "COMP SCI 577" -> "CS 577", the short form the timetable blocks and tags use. */
export const shortCode = (code: string) => friendlyCourseCode(code.replace(/^COMP SCI /, 'CS '));
/** "COMP SCI 577" -> "577", for the square room badge. */
export const courseNumber = (code: string) => code.match(/\d+[A-Z]*$/i)?.[0] ?? code.slice(0, 3);

/** 570 -> "9:30", 780 -> "1:00". */
const clock = (min: number) => `${Math.floor(min / 60) % 12 || 12}:${String(min % 60).padStart(2, '0')}`;
const half = (min: number) => (Math.floor(min / 60) % 24 < 12 ? 'AM' : 'PM');
/** 540 -> "9 AM", 570 -> "9:30 AM". */
export const hourLabel = (min: number) => `${min % 60 ? clock(min) : Math.floor(min / 60) % 12 || 12} ${half(min === 1440 ? 0 : min)}`;
/** "9:30–10:45 AM". Both halves are named only when they differ. */
export const timeRange = (start: number, end: number) => `${clock(start)}${half(start) === half(end) ? '' : ` ${half(start)}`}–${clock(end)} ${half(end)}`;
export const timeOfDay = (min: number) => `${clock(min)} ${half(min)}`;

/** "Tue, Thu · 9:30–10:45 AM", one phrase per distinct time slot. */
export function meetingSummary(meetings: Slot[], separator = ' · '): string {
  const slots = new Map<string, number[]>();
  for (const meeting of [...meetings].sort((a, b) => dayIndex(a.day) - dayIndex(b.day) || a.start_min - b.start_min)) {
    const key = `${meeting.start_min}-${meeting.end_min}`;
    slots.set(key, [...(slots.get(key) ?? []), dayIndex(meeting.day)]);
  }
  return [...slots].map(([key, days]) => {
    const [start, end] = key.split('-').map(Number);
    return `${days.map((day) => DAY_SHORT[day]).join(', ')}${separator}${timeRange(start, end)}`;
  }).join('; ');
}

/** "M–Th" for a run of days, "M, W, F" otherwise. Takes indexes into DAYS. */
export function dayRange(days: number[], names: string[] = DAY_TINY): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (!sorted.length) return 'No days';
  const run = sorted.every((day, i) => i === 0 || day === sorted[i - 1] + 1);
  return run && sorted.length > 2 ? `${names[sorted[0]]}–${names[sorted.at(-1)!]}` : sorted.map((day) => names[day]).join(', ');
}

/** "Morgridge Hall" -> "Morgridge": the one-line place under a timetable block. */
export const shortPlace = (name: string) => name.replace(/\s+(Hall|Building|Bldg\.?|Center|Ctr\.?)$/i, '');

/** "2h", "3d": how long ago something was posted. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 43_200) return `${Math.floor(minutes / 1440)}d`;
  return new Date(iso).toLocaleDateString([], {month: 'short', day: 'numeric'});
}

/** Chat list stamp: a time today, "Yesterday", a weekday this week, a date before that. */
export function stamp(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.ceil((startOfToday - date.getTime()) / 86_400_000);
  if (days <= 0) return date.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  if (days === 1) return 'Yesterday';
  if (days < 7) return DAY_SHORT[(date.getDay() + 6) % 7];
  return date.toLocaleDateString([], {month: 'short', day: 'numeric'});
}

/** "Fall 2026" -> "F26", the GPA chart's axis label. */
export const termTick = (label: string) => label.replace(/^(\w)\w*\s+\d{2}(\d{2}).*$/, '$1$2');

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "COMP SCI 540 & 564" reads badly past two courses, so a longer list names the first and counts the rest. */
export const courseList = (codes: string[]) => (codes.length > 2 ? `${codes[0]} & ${codes.length - 1} more` : codes.join(' & '));
