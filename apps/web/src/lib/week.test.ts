import {expect, test} from 'vitest';
import {gridHours} from './week';
test('week grid frames the selected classes instead of starting every timetable at 8 AM', () => {
  expect(gridHours([{start_min: 660, end_min: 710}, {start_min: 870, end_min: 945}])).toEqual({start: 10, end: 17});
  expect(gridHours([{start_min: 570, end_min: 945}])).toEqual({start: 9, end: 17});
  expect(gridHours([{start_min: 420, end_min: 1320}])).toEqual({start: 6, end: 23});
  expect(gridHours([])).toEqual({start: 8, end: 17});
});
