// UW 2026–27 Guide and Spring 2027 requirement group 013516.
// https://guide.wisc.edu/courses/comp_sci/
export const CS400_PREREQUISITE = {
  courseId: 'uw-024798',
  prerequisiteId: 'uw-024795',
  terms: new Set(['1272', '1274']),
  message: 'COMP SCI 400 requires COMP SCI 300 before the selected semester. Check your Course History for prior credit or earlier enrollment.',
};

export type PriorAttempt = {
  term: string;
  status: string;
  grade_entries: {letter_grade: string | null} | null;
  terms: {is_current: boolean} | null;
};

export function hasPriorPrerequisite(attempts: PriorAttempt[], selectedTerm: string): boolean {
  return attempts.some(({term, status, grade_entries, terms}) => {
    if (!/^\d{4}$/.test(term) || term >= selectedTerm) return false;
    if (status === 'completed') return grade_entries?.letter_grade !== 'F';
    return status === 'enrolled_self_reported' && terms?.is_current === true;
  });
}
