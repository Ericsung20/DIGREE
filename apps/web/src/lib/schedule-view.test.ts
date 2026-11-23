import {expect, test} from 'vitest';
import {scheduleUrl, scheduleView} from './schedule-view';

const terms = [{id: 'fall-2026'}, {id: 'spring-2027'}];
test('Spring 2027 opens the saved plan while the current semester opens enrollment', () => {
  expect(scheduleView(null, 'spring-2027', 'fall-2026', terms)).toBe('plans');
  expect(scheduleView(null, 'fall-2026', 'fall-2026', terms)).toBe('enrolled');
  expect(scheduleView('enrolled', 'spring-2027', 'fall-2026', terms)).toBe('enrolled');
  expect(scheduleView('plans', 'fall-2026', 'fall-2026', terms)).toBe('plans');
});
test('saving navigates to the selected semester and preserves an explicit view', () => {
  expect(scheduleUrl('plans', '1274', '1272')).toBe('/?term=1274&view=plans');
  expect(scheduleUrl('enrolled', '1274', '1272')).toBe('/?term=1274&view=enrolled');
  expect(scheduleUrl('enrolled', '1272', '1272')).toBe('/?view=enrolled');
  expect(scheduleUrl('plans', '1274', '1272', 'saved-plan-2')).toBe('/?term=1274&view=plans&plan=saved-plan-2');
});
