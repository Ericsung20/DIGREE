import {expect, test} from 'vitest';
import {majorCourseRules} from './major-courses';
test('major courses use actual requirements across all majors, not department prefixes or college breadth', () => {
  const rules = majorCourseRules([
    {course_code: 'COMP SCI 537', program: 'Computer Sciences, BS', requirement_group: 'Requirements for the Major / Software & Hardware'},
    {course_code: 'COMP SCI 320', program: 'Data Science, BS', requirement_group: 'Requirements for the Major / Foundational Data Science Courses'},
    {course_code: 'L I S 440', program: 'Data Science, BS', requirement_group: 'Requirements for the Major / Electives / Other electives'},
    {course_code: 'ANTHRO 105', requirement_group: 'College of Letters & Science Degree Requirements / Breadth'},
    {course_code: 'ENGL 100', requirement_group: 'University Requirements / Communication'},
  ]);
  expect([...rules.keys()]).toEqual(['COMP SCI 537', 'COMP SCI 320', 'L I S 440']);
  expect(rules.get('L I S 440')).toEqual(['Data Science · Other electives']);
});
