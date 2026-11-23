import {expect, test} from 'vitest';
import {degreeCreditMinimum, estimateRequirement, requirementOverlapIds, requirementTitle} from './academic-progress';
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

test('course-only transfer awards feed degree and requisite evidence without source metadata', () => {
  const award: TransferCredit = {...transfer, institution: null, source_course: null};
  expect(validateTransfer(award, [])).toBeNull();
  expect(validateTransfer({...award, equivalent_course_id: null}, [])).toMatch(/Choose the UW course/);
  expect(validateTransfer(award, [award])).toMatch(/already/);
  expect(countedTransferCredits([award], new Set()).reduce((sum, row) => sum + row.credits, 0)).toBe(3);
  const aliases = new Map([['cross240', ['COMP SCI 240', 'MATH 240']]]);
  const prior = {...award, courses: {code: 'COMP SCI 240'}};
  expect(evaluateRequisites('MATH 240', requisiteEvidence([], '1274', aliases, [], true, [prior]))).toBe('met');
  const result = estimateRequirement(group([{kind: 'course', courses: [{code: 'MATH 240'}], credits: '3'}]),
    [{course_id: award.equivalent_course_id!, codes: aliases.get('cross240')!, credits: award.credits, state: 'd', transfer: true}]);
  expect(result.items[0].state).toBe('d');
  expect(result.done).toBe(true);
  const review = estimateRequirement(group([{kind: 'course', courses: [{code: 'MATH 240'}], credits: '3'}, {kind: 'condition', label: 'Residency applies.'}]),
    [{course_id: award.equivalent_course_id!, codes: aliases.get('cross240')!, credits: award.credits, state: 'd', transfer: true}]);
  expect(review.count).toBe('1 matched');
  expect(review.done).toBe(false);
});

test('requirement titles omit repeated ancestry and footnote markers', () => {
  expect(requirementTitle('Requirements for the Major / Additional Mathematics / Linear Algebra')).toBe('Linear Algebra');
  expect(requirementTitle('Requirements for the Major / Advanced Computer Science Courses1 / Electives1')).toBe('Electives');
  expect(requirementTitle('University Requirements / Core General Education (Core GenEd) Requirements')).toBe('General education');
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

test('requirement display retains every condition alongside course options for any major', () => {
  const rows = [
    {kind: 'condition', label: 'At least 30 credits in residence.'},
    {kind: 'criterion', label: 'Quality of Work', description: 'A minimum GPA of 2.0 is required.'},
    {kind: 'criterion', label: 'Complete one:', credits: '3'},
    {kind: 'course', courses: [{code: 'COMP SCI 240', published_code: 'COMP SCI/MATH 240'}], description: 'Discrete Mathematics', credits: '3'},
    {kind: 'condition', label: 'Advisor approval is required for substitutions.'},
  ];
  for (const name of ['Computer Sciences', 'Economics', 'Nursing']) {
    const result = estimateRequirement(group(rows, `${name} requirements`), evidence);
    expect(result.rules).toHaveLength(rows.length);
    expect(result.rules?.[0].label).toContain('30 credits');
    expect(result.rules?.[1].description).toContain('GPA of 2.0');
    expect(result.rules?.[3].courses).toEqual(['COMP SCI/MATH 240']);
    expect(result.rules?.[4].label).toContain('Advisor approval');
    expect(result.review).toBe(true);
  }
});
