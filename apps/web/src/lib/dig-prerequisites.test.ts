import {expect, test} from 'vitest';
import {hasPriorPrerequisite, type PriorAttempt} from './dig-prerequisites';

const prior: PriorAttempt = {
  term: '1272',
  status: 'completed',
  grade_entries: null,
  terms: {is_current: true},
};

test('only an earlier completed attempt or an earlier current enrollment clears the prerequisite', () => {
  const target = '1274';
  expect(hasPriorPrerequisite([], target)).toBe(false);
  expect(hasPriorPrerequisite([{...prior, status: 'planned'}], target)).toBe(false);
  expect(hasPriorPrerequisite([{...prior, term: target}], target)).toBe(false);
  expect(hasPriorPrerequisite([{...prior, grade_entries: {letter_grade: 'F'}}], target)).toBe(false);
  expect(hasPriorPrerequisite([{...prior, term: '1266', status: 'enrolled_self_reported', terms: {is_current: false}}], target)).toBe(false);
  expect(hasPriorPrerequisite([prior], target)).toBe(true);
  expect(hasPriorPrerequisite([{...prior, status: 'enrolled_self_reported'}], target)).toBe(true);
});
