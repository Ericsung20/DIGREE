import {expect, test} from 'vitest';
import {rememberedScheduleUrl} from './data/schedule-location';
test('the Schedule tab returns to the saved semester and selected plan, including after another screen', () => {
  expect(rememberedScheduleUrl({term: '1274', view: 'plans', plan: 'second'})).toBe('/?term=1274&view=plans&plan=second');
  expect(rememberedScheduleUrl({term: '1272', view: 'enrolled'})).toBe('/?term=1272&view=enrolled');
  expect(rememberedScheduleUrl(null)).toBe('/');
});
