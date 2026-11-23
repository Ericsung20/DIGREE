import {expect, test} from 'vitest';
import {candidateScore, compatibleSections, graduateLevel, graduateProgram, knownEasy, pickCandidates, sectionFits, smoothedGrade, type Candidate, type SlotMeeting, type TimeWindow} from './dig-candidates';

const at = (day: SlotMeeting['day'], start: number, end: number, mode: SlotMeeting['mode'] = 'in_person'): SlotMeeting => ({day, start_min: start, end_min: end, mode});
const window: TimeWindow = {earliest: 540, latest: 1320, blockedDays: ['FRI', 'SAT', 'SUN'], online: true};

test('sectionFits keeps to the hours, days and online choice, and skips sections without times', () => {
  expect(sectionFits([at('MON', 540, 590), at('WED', 1250, 1320)], window)).toBe(true);
  expect(sectionFits([at('MON', 530, 590)], window)).toBe(false); // starts before 9
  expect(sectionFits([at('MON', 1260, 1330)], window)).toBe(false); // ends after 10 PM
  expect(sectionFits([at('FRI', 600, 650)], window)).toBe(false);
  expect(sectionFits([at('TUE', 600, 650, 'online_sync')], window)).toBe(true);
  expect(sectionFits([at('TUE', 600, 650, 'online_sync')], {...window, online: false})).toBe(false);
  expect(sectionFits([], window)).toBe(false); // independent study and asynchronous sections
});

test('compatibleSections leaves room for at least one section of every must-take', () => {
  const sections = [{id: 'early', meetings: [at('MON', 600, 650)]}, {id: 'late', meetings: [at('MON', 780, 830)]}];
  // The must-take meets Monday at 10 or at 1: either section of the candidate leaves one free.
  expect(compatibleSections(sections, [[[at('MON', 600, 650)], [at('MON', 780, 830)]]], window).map(({id}) => id)).toEqual(['early', 'late']);
  // Only one must-take section: the candidate section on top of it goes.
  expect(compatibleSections(sections, [[[at('MON', 600, 650)]]], window).map(({id}) => id)).toEqual(['late']);
  // A must-take with no section inside the window is left to the optimizer to report.
  expect(compatibleSections(sections, [[]], window)).toHaveLength(2);
});

const course = (over: Partial<Candidate>): Candidate => ({id: over.code ?? 'x', code: 'X 100', credits: 3, major: false, designation: false, related: false, eligible: true, grade: null, ...over});

test('candidateScore puts relevance first, then grade outcomes', () => {
  const easyElective = course({code: 'EASY 101', grade: {a_ab_rate: 1, sample_size: 5000}});
  const hardMajor = course({code: 'MAJ 400', major: true, grade: {a_ab_rate: 0.2, sample_size: 5000}});
  expect(candidateScore(hardMajor)).toBeGreaterThan(candidateScore(easyElective));
  const kindMajor = course({code: 'MAJ 401', major: true, grade: {a_ab_rate: 0.9, sample_size: 500}});
  expect(candidateScore(kindMajor)).toBeGreaterThan(candidateScore(hardMajor));
  // A tiny class with a perfect record does not beat a large one with a strong record.
  expect(smoothedGrade({a_ab_rate: 1, sample_size: 4})!).toBeLessThan(smoothedGrade({a_ab_rate: 0.85, sample_size: 800})!);
  // Unconfirmed requisites and one-credit courses rank lower.
  expect(candidateScore(course({eligible: false}))).toBeLessThan(candidateScore(course({})));
  expect(candidateScore(course({credits: 1}))).toBeLessThan(candidateScore(course({})));
});

test('pickCandidates keeps non-major courses in the mix when the major count matters', () => {
  const majors = Array.from({length: 30}, (_, i) => course({id: `m${i}`, code: `MAJ ${300 + i}`, major: true}));
  const others = Array.from({length: 30}, (_, i) => course({id: `o${i}`, code: `ELEC ${100 + i}`}));
  const count = (list: Candidate[]) => list.filter((item) => item.major).length;
  expect(count(pickCandidates([...majors, ...others], 20, 'balanced'))).toBe(12);
  expect(count(pickCandidates([...majors, ...others], 20, 3))).toBe(12);
  expect(count(pickCandidates([...majors, ...others], 20, 0))).toBe(0);
  expect(count(pickCandidates([...majors, ...others], 20, 'none'))).toBe(20); // relevance alone
  // Too few of one group: the other fills the slots.
  expect(pickCandidates([...majors, ...others.slice(0, 2)], 20, 'balanced')).toHaveLength(20);
  expect(pickCandidates(others.slice(0, 5), 20, 'balanced')).toHaveLength(5);
});

test('graduateLevel marks 700-level courses and up; graduateProgram reads graduate degree labels', () => {
  expect(graduateLevel('COMP SCI 577')).toBe(false); // 500–699: undergraduates take these too
  expect(graduateLevel('COMP SCI 760')).toBe(true);
  expect(graduateLevel('ED POL 900A')).toBe(true);
  expect(graduateLevel('MATH 221')).toBe(false);
  expect(graduateProgram('Computer Science, BS')).toBe(false);
  expect(graduateProgram('Mathematics (BA)')).toBe(false);
  expect(graduateProgram('Computer Science & Engineering, MS')).toBe(true);
  expect(graduateProgram('Statistics, PhD')).toBe(true);
  expect(graduateProgram('Master of Public Health')).toBe(true);
  expect(graduateProgram('')).toBe(false);
});

test('knownEasy matches the listed courses, subjects and ranges, also through cross-listed codes', () => {
  expect(knownEasy(['MUSIC 113'])).toBe(1);
  expect(knownEasy(['MUSIC 114'])).toBe(0);
  expect(knownEasy(['ENGL 176'])).toBe(0.8);
  expect(knownEasy(['ENGL 100'])).toBe(0);
  expect(knownEasy(['ASTRON 103'])).toBe(0.7);
  expect(knownEasy(['ASTRON 200'])).toBe(0);
  expect(knownEasy(['ED POL 150'])).toBe(0.6);
  expect(knownEasy(['L I S 201'])).toBe(0.6);
  expect(knownEasy(['ANTHRO 210', 'FOLKLORE 210'])).toBe(0.6);
  expect(knownEasy(['COMP SCI 400'])).toBe(0);
});

test('candidateScore lifts a known-easy course above an otherwise equal one', () => {
  const plain = {id: 'a', code: 'X 100', credits: 3, major: false, designation: false, related: false, eligible: true, grade: null};
  expect(candidateScore({...plain, easy: 1})).toBeGreaterThan(candidateScore(plain));
});
