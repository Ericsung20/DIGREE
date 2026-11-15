/** Course Search & Enroll designations. The second group is legacy Gen Ed. */
export const BREADTH_OPTIONS = [
  {code: 'H', label: 'Humanities', group: 'Breadth'},
  {code: 'L', label: 'Literature', group: 'Breadth'},
  {code: 'S', label: 'Social Science', group: 'Breadth'},
  {code: 'N', label: 'Natural Science', group: 'Breadth'},
  {code: 'B', label: 'Biological Science', group: 'Breadth'},
  {code: 'P', label: 'Physical Science', group: 'Breadth'},
  {code: 'W', label: 'Social or Natural', group: 'Breadth'},
  {code: 'X', label: 'Humanities or Natural', group: 'Breadth'},
  {code: 'Y', label: 'Biological or Social', group: 'Breadth'},
  {code: 'Z', label: 'Humanities or Social', group: 'Breadth'},
  {code: 'I', label: 'Interdivisional', group: 'Breadth'},
  {code: 'COMM_A', label: 'Comm A', group: 'General education'},
  {code: 'COMM_B', label: 'Comm B', group: 'General education'},
  {code: 'QR_A', label: 'QR A', group: 'General education'},
  {code: 'QR_B', label: 'QR B', group: 'General education'},
  {code: 'ETHNIC', label: 'Ethnic Studies', group: 'General education'},
] as const;

export type BreadthCode = (typeof BREADTH_OPTIONS)[number]['code'];

/** A course with a narrower science or literature designation also satisfies its parent breadth. */
export function expandBreadthCodes(codes: string[]): string[] {
  const parents: Record<string, string[]> = {L: ['H'], B: ['N'], P: ['N'], W: ['S', 'N'], X: ['H', 'N'], Y: ['B', 'S', 'N'], Z: ['H', 'S']};
  return [...new Set(codes.flatMap((code) => [code, ...(parents[code] ?? [])]))];
}

export function matchingRawBreadthCodes(preferred: string[]): string[] {
  return BREADTH_OPTIONS.filter(({code}) => code.length === 1 && expandBreadthCodes([code]).some((tag) => preferred.includes(tag)))
    .map(({code}) => code);
}

export type CourseDesignationRow = {course_id: string; general_ed_code: string | null; ethnic_studies_code: string | null};
export const GENERAL_ED_CODES: Record<string, string> = {COMM_A: 'A', COMM_B: 'B', QR_A: 'Q', QR_B: 'R'};

export function generalEducationTags(row: CourseDesignationRow): string[] {
  const codes = (row.general_ed_code ?? '').toUpperCase();
  return [
    ...Object.entries(GENERAL_ED_CODES).flatMap(([tag, code]) => codes.includes(code) ? [tag] : []),
    ...(row.ethnic_studies_code ? ['ETHNIC'] : []),
  ];
}
