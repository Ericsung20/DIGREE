import {expect, test} from 'vitest';
import {evaluateRequisites, requisiteEvidence, type PriorAttempt} from './dig-prerequisites';

function attempt(courseCode: string, over: Partial<PriorAttempt> = {}): PriorAttempt {
  return {
    course_id: courseCode, term: '1272', status: 'completed', courses: {code: courseCode},
    grade_entries: null, terms: {is_current: true}, ...over,
  };
}

function check(rule: string | null, history: PriorAttempt[] = [], required: string[] = []) {
  const aliases = new Map([['MATH 240', ['COMP SCI 240']]]);
  return evaluateRequisites(rule, requisiteEvidence(
    history, '1274', aliases, required.map(code => ({id: code, code})), true,
  ));
}

test('checks UW alternatives and conjunctions using prior course credit', () => {
  const stat340 = '(MATH 211, 217, or 221) and STAT 240';
  expect(check(stat340, [attempt('MATH 221'), attempt('STAT 240')])).toBe('met');
  expect(check(stat340, [attempt('STAT 240')])).toBe('unmet');
  expect(check(stat340, [attempt('MATH 221')], ['STAT 240'])).toBe('unmet');
  expect(check('COMP SCI 300, graduate/professional standing, or declared in the Capstone Certificate in Computer Sciences for Professionals')).toBe('unmet');
});

test('distinguishes prior provisional enrollment, failed credit and same-term prerequisites', () => {
  const rule = 'COMP SCI 300';
  expect(check(rule, [attempt(rule, {status: 'enrolled_self_reported'})])).toBe('conditional');
  expect(check(rule, [attempt(rule, {status: 'enrolled_self_reported', terms: {is_current: false}})])).toBe('unmet');
  expect(check(rule, [attempt(rule, {grade_entries: {letter_grade: 'F'}})])).toBe('unmet');
  expect(check(rule, [attempt(rule, {term: '1274'})])).toBe('unmet');
});

test('supports cross-listed credit, minimum grades and explicit concurrency', () => {
  expect(check('COMP SCI 240', [attempt('MATH 240')])).toBe('met');
  expect(check('MATH/COMP SCI 240', [attempt('MATH 240')])).toBe('met');
  expect(check('A grade of C or better in MATH 221', [attempt('MATH 221')])).toBe('review');
  expect(check('A grade of C or better in MATH 221', [attempt('MATH 221', {grade_entries: {letter_grade: 'D'}})])).toBe('unmet');
  expect(check('MATH 222 or concurrent enrollment', [], ['MATH 222'])).toBe('conditional');
  expect(check('Concurrent enrollment in MATH 222', [attempt('MATH 222')])).toBe('unmet');
});

test('keeps uncertain cases in review and rejects explicit prior-credit exclusions', () => {
  expect(check(null)).toBe('review');
  expect(check('None')).toBe('met');
  expect(check('Consent of instructor or COMP SCI 300')).toBe('review');
  expect(check('Satisfied Quantitative Reasoning (QR) A and MATH 221')).toBe('unmet');
  expect(check('MATH 221. Not open to students with credit for MATH 217 or 211', [attempt('MATH 221'), attempt('MATH 211')])).toBe('unmet');
  expect(check('MATH 211, MATH 221')).toBe('review');
  expect(check('MATH 211 or MATH 221 and STAT 240')).toBe('review');
});
