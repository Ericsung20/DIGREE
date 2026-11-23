import {expect, test} from 'vitest';
import {degreeCreditMinimum, estimateRequirement, requirementOverlapIds} from './academic-progress';
import {isExistingSignup, normalizeEmail} from './auth-signup';
import {displayCourseCode, expandCourseCode, matchesCourseCode, normalizeCourseCode} from './course-identity';
import {countedTransferCredits, validateTransfer, type TransferCredit} from './data/transfer-credits';
import type {CatalogRequirement} from './data/academic-catalog';
import {evaluateRequisites, requisiteEvidence} from './dig-prerequisites';

test('cross-list display preserves canonical identity and resolves either alias', () => {
  const course = {id: 'uw-011630', code: 'COMP SCI 240', display_code: 'CS/MATH 240', aliases: ['COMP SCI 240', 'MATH 240']};
  for (const code of ['cs240', 'CS 240', 'MATH 240', 'COMP SCI 240', 'CS/MATH 240']) expect(matchesCourseCode(course, code)).toBe(true);
  expect(matchesCourseCode(course, 'STAT 240')).toBe(false);
  expect(normalizeCourseCode(' math240 ')).toBe('MATH 240');
  expect(expandCourseCode('COMP SCI/MATH 240')).toEqual(['COMP SCI 240', 'MATH 240']);
  expect(displayCourseCode(course)).toBe('CS/MATH 240');
  expect(course.code).toBe('COMP SCI 240');
});

test('signup normalizes email and detects Auth duplicate obfuscation', () => {
  expect(normalizeEmail(' User@WISC.EDU ')).toBe('user@wisc.edu');
  expect(isExistingSignup({identities: []})).toBe(true);
  expect(isExistingSignup({identities: [{provider: 'email'}]})).toBe(false);
  expect(isExistingSignup(null)).toBe(false);
});

const transfer: TransferCredit = {id: 'credit-1', institution: 'Other School', source_course: 'MAT 240', credits: 3, equivalent_course_id: 'cross240', awarded_term: '1272', notes: ''};
test('transfer validation and credit counting prevent duplicate source/equivalent credit', () => {
  expect(validateTransfer(transfer, [])).toBeNull();
  expect(validateTransfer({...transfer, credits: 1.1}, [])).toBeNull();
  expect(validateTransfer({...transfer, credits: 1.111}, [])).not.toBeNull();
  expect(validateTransfer({...transfer, institution: ' other school '}, [transfer])).toMatch(/already/);
  expect(validateTransfer({...transfer, source_course: 'X 999'}, [transfer])).toMatch(/already/);
  expect(countedTransferCredits([transfer], new Set(['cross240']))).toEqual([]);
  expect(countedTransferCredits([{...transfer, equivalent_course_id: null}], new Set(['cross240']))).toHaveLength(1);
});

test('recognized equivalents satisfy aliases without inventing grades, concurrency or future credit', () => {
  const aliases = new Map([['cross240', ['COMP SCI 240', 'MATH 240']]]);
  const credit = {equivalent_course_id: 'cross240', awarded_term: '1272', courses: {code: 'COMP SCI 240'}};
  const evidence = requisiteEvidence([], '1274', aliases, [], true, [credit]);
  expect(evaluateRequisites('MATH 240', evidence)).toBe('met');
  expect(evaluateRequisites('A grade of C or better in COMP SCI 240', evidence)).toBe('review');
  expect(evaluateRequisites('Concurrent enrollment in COMP SCI 240', evidence)).toBe('unmet');
  expect(evaluateRequisites('COMP SCI 240', requisiteEvidence([], '1272', aliases, [], true, [{...credit, awarded_term: '1274'}]))).toBe('unmet');
  expect(evaluateRequisites('COMP SCI 240', requisiteEvidence([], '1274', aliases, [], true, [{...credit, equivalent_course_id: null}]))).toBe('unmet');
});

const group = (rows: CatalogRequirement['definition']['rows'], heading = 'Basic courses'): CatalogRequirement => ({id: 'req', program_version_id: 'major:p', position: 1, heading, definition: {rows}, source_url: 'https://guide.wisc.edu/example'});
const evidence = [{course_id: 'cross240', codes: ['COMP SCI 240', 'MATH 240'], credits: 3, state: 'd' as const, transfer: true}];
test('degree minimum comes from the degree rule, not GenEd or major subtotals', () => {
  expect(degreeCreditMinimum([
    group([{label: 'Total Credits', credit_conditions: ['30 credits']}], 'Core General Education'),
    group([{label: 'Total Credits', credit_conditions: ['120 credits']}], 'College Degree Requirements'),
    group([{label: 'Total Credits', credits: '45'}], 'Requirements for the Major'),
  ])).toBe(120);
  expect(degreeCreditMinimum([])).toBeNull();
});

test('an explicit choose-one group accepts a mapped transfer without requiring all alternatives', () => {
  const result = estimateRequirement(group([{kind: 'criterion', label: 'Complete one:'},
    {kind: 'course', courses: [{code: 'MATH 240'}], credits: '3'}, {kind: 'course', courses: [{code: 'MATH 340'}], credits: '3'}]), evidence);
  expect(result.done).toBe(true);
  expect(result.count).toBe('1 of 1');
});

test.each([
  [{kind: 'criterion', label: 'Minimum grade C'}],
  [{kind: 'criterion', label: 'Residency'}],
  [{kind: 'criterion', label: 'Complete one:', credits: '6-8'}],
  [{kind: 'criterion', label: 'Total Credits', credit_conditions: ['6 credits']}],
])('unsupported or unmet conditions cannot become a degree pass: %j', extra => {
  const result = estimateRequirement(group([{kind: 'criterion', label: 'Complete one:'}, {kind: 'course', courses: [{code: 'MATH 240'}], credits: '3'}, extra]), evidence);
  expect(result.done).toBe(false);
  expect(result.review).toBe(true);
});
test('overlap and residency rules remain review even when equivalent courses match', () => {
  const base = group([{kind: 'course', courses: [{code: 'MATH 240'}], credits: '3'}]);
  expect(estimateRequirement(base, evidence, true).done).toBe(false);
  expect(estimateRequirement({...base, heading: 'Residency'}, evidence).done).toBe(false);
});

test('cross-listed names cannot count as separate courses across requirement groups', () => {
  const first = group([{kind: 'course', courses: [{code: 'MATH 240'}], credits: '3'}]);
  const second = {...group([{kind: 'course', courses: [{code: 'COMP SCI 240'}], credits: '3'}]), id: 'other'};
  expect([...requirementOverlapIds([first, second], evidence)].sort()).toEqual(['other', 'req']);
  expect(countedTransferCredits([transfer], new Set(['cross240']), new Set(['cross240']))).toHaveLength(1);
});
