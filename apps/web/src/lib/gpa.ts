// Pure GPA math. No storage, no UI.
export const GRADE_POINTS = {A: 4, AB: 3.5, B: 3, BC: 2.5, C: 2, D: 1, F: 0} as const;
export type LetterGrade = keyof typeof GRADE_POINTS;
export const LETTER_GRADES = Object.keys(GRADE_POINTS) as LetterGrade[];

export type GpaRow = {
  term: string;
  status: 'planned' | 'enrolled_self_reported' | 'completed' | 'withdrawn';
  credits: number;
  grade: LetterGrade | null;
  major: boolean; // counts_toward_major
};

const sum = (rows: {credits: number}[]) => rows.reduce((s, r) => s + r.credits, 0);

/** Credit-weighted GPA over graded rows. Null when nothing is graded. */
export function gpa(rows: Pick<GpaRow, 'credits' | 'grade'>[]): number | null {
  const graded = rows.filter((r) => r.grade !== null);
  const credits = sum(graded);
  return credits === 0 ? null : graded.reduce((s, r) => s + GRADE_POINTS[r.grade!] * r.credits, 0) / credits;
}

/**
 * Cumulative and major GPA use completed courses only. In-progress (self-reported) grades are
 * projections: they appear in their term's GPA, flagged `projected`, and never in the cumulative.
 * Planned and withdrawn rows are ignored. Pass/fail, incomplete and repeats are not modelled.
 */
export function summarize(rows: GpaRow[], termOrder: string[]) {
  const done = rows.filter((r) => r.status === 'completed');
  const current = rows.filter((r) => r.status === 'enrolled_self_reported');
  const counted = [...done, ...current];
  const earned = done.filter((r) => r.grade !== 'F'); // a failed course earns no credit
  return {
    cumulative: gpa(done),
    major: gpa(done.filter((r) => r.major)),
    creditsEarned: sum(earned),
    majorCredits: sum(earned.filter((r) => r.major)),
    inProgress: sum(current),
    terms: termOrder
      .filter((t) => counted.some((r) => r.term === t))
      .map((t) => {
        const inTerm = counted.filter((r) => r.term === t);
        return {term: t, overall: gpa(inTerm), major: gpa(inTerm.filter((r) => r.major)), projected: inTerm.some((r) => r.status === 'enrolled_self_reported')};
      }),
  };
}
