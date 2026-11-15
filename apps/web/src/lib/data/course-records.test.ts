import {expect, test} from 'vitest';
import {COLLEGES, programsFor} from './catalog';
import {validateRecord, type CourseRecord, type CourseRecordDraft} from './course-records';

const draft = (over: Partial<CourseRecordDraft> = {}): CourseRecordDraft => ({
  term: '2027SP',
  course_id: 'cs400',
  credits: 3,
  status: 'enrolled_self_reported',
  bundle_id: 'cs400-A',
  counts_toward_major: false,
  source: 'manual',
  ...over,
});

test("programsFor returns only the selected college's programs", () => {
  for (const college of COLLEGES) {
    const programs = programsFor(college.id);
    expect(programs.length).toBeGreaterThan(0);
    expect(programs.every((p) => p.college_id === college.id)).toBe(true);
  }
  expect(programsFor('nope')).toEqual([]);
});

test('validateRecord blocks duplicates and off-term self-reported enrollment', () => {
  const existing: CourseRecord[] = [{...draft(), id: '1'}];
  expect(validateRecord([], draft(), '2027SP')).toBeNull();
  expect(validateRecord(existing, draft(), '2027SP')).toMatch(/Already added/);
  expect(validateRecord(existing, draft({term: '2026FA', status: 'completed', bundle_id: null}), '2027SP')).toBeNull();
  expect(validateRecord([], draft({term: '2026FA'}), '2027SP')).toMatch(/current term only/);
  expect(validateRecord([], draft({term: '2027FA', status: 'planned'}), '2027SP')).toBeNull();
});
