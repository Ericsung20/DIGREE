import {expect, test} from 'vitest';
import {byDayThenStart, minToLabel} from './time';

test('minToLabel formats minutes after midnight', () => {
  expect(minToLabel(600)).toBe('10:00 AM');
  expect(minToLabel(675)).toBe('11:15 AM');
  expect(minToLabel(0)).toBe('12:00 AM');
  expect(minToLabel(720)).toBe('12:00 PM');
  expect(minToLabel(770)).toBe('12:50 PM');
  expect(minToLabel(1080)).toBe('6:00 PM');
  expect(minToLabel(1440)).toBe('12:00 AM');
});

test('byDayThenStart orders by weekday, then start time', () => {
  const sorted = [
    {day: 'WED', start_min: 600},
    {day: 'MON', start_min: 720},
    {day: 'SUN', start_min: 0},
    {day: 'MON', start_min: 600},
  ] as const;
  expect([...sorted].sort(byDayThenStart).map((m) => `${m.day}${m.start_min}`)).toEqual(['MON600', 'MON720', 'WED600', 'SUN0']);
});
