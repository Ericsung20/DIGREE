import {expect, test} from 'vitest';
import {gpa, summarize, type GpaRow, type LetterGrade} from './gpa';

const row = (grade: LetterGrade | null, credits: number, over: Partial<GpaRow> = {}): GpaRow => ({term: '2026FA', status: 'completed', credits, grade, major: false, ...over});
const TERMS = ['2026SP', '2026FA', '2027SP'];

test('hand example 1: A(3) AB(4) B(3) = 35/10 = 3.50, major-only A(3) = 4.00', () => {
  const s = summarize([row('A', 3, {major: true}), row('AB', 4), row('B', 3)], TERMS);
  expect(s.cumulative).toBeCloseTo(3.5, 10);
  expect(s.major).toBe(4);
  expect([s.creditsEarned, s.majorCredits, s.inProgress]).toEqual([10, 3, 0]);
});

test('hand example 2: BC(4) C(3) F(3) = 16/10 = 1.60, and the F earns no credit', () => {
  const s = summarize([row('BC', 4), row('C', 3), row('F', 3, {major: true})], TERMS);
  expect(s.cumulative).toBeCloseTo(1.6, 10);
  expect(s.major).toBe(0);
  expect([s.creditsEarned, s.majorCredits]).toEqual([7, 0]);
});

test('GPA is credit-weighted, not a plain average', () => {
  expect(gpa([row('A', 1), row('C', 3)])).toBe(2.5); // plain average would be 3.0
});

test('boundaries: no grades and zero major courses give null, not 0', () => {
  expect(gpa([])).toBeNull();
  const s = summarize([row(null, 3), row('B', 3)], TERMS);
  expect(s.cumulative).toBe(3); // the ungraded course is skipped
  expect(s.major).toBeNull();
  expect(summarize([], TERMS)).toMatchObject({cumulative: null, major: null, creditsEarned: 0, terms: []});
});

test('in-progress grades are projected: in the term series, never in the cumulative', () => {
  const s = summarize(
    [row('A', 3), row('C', 3, {term: '2027SP', status: 'enrolled_self_reported'}), row('A', 3, {term: '2027SP', status: 'planned'}), row('F', 3, {status: 'withdrawn'})],
    TERMS,
  );
  expect(s.cumulative).toBe(4);
  expect(s.inProgress).toBe(3);
  expect(s.terms).toEqual([
    {term: '2026FA', overall: 4, major: null, projected: false},
    {term: '2027SP', overall: 2, major: null, projected: true},
  ]);
});
