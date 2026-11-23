/** Display labels never replace canonical codes used by the optimizer or DARS. */
export function normalizeCourseCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ').replace(/^CS(?=\s|\d|$)/, 'COMP SCI')
    .replace(/([A-Z])\s*(\d{2,4}[A-Z]?)$/, '$1 $2').replace(/^MARKETING(?=\s|$)/, 'MARKETNG');
}

export function expandCourseCode(value: string): string[] {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = /^(.+?)\s*(\d{2,4}[A-Z]?)$/.exec(normalized);
  return match ? match[1].split('/').map(subject => normalizeCourseCode(`${subject.trim()} ${match[2]}`)) : [normalizeCourseCode(value)];
}

export function displayCourseCode(course: {code: string; display_code?: string | null}): string {
  return friendlyCourseCode(course.display_code ?? course.code.replace(/^COMP SCI /, 'CS '));
}

/** Readable subject labels; official identities stay in code/aliases. */
export const friendlyCourseCode = (code: string) => code.replace(/\bMARKETNG\b/g, 'Marketing');

export function matchesCourseCode(course: {code: string; aliases?: string[]}, value: string): boolean {
  const known = new Set([course.code, ...(course.aliases ?? [])].flatMap(expandCourseCode));
  return expandCourseCode(value).some(code => known.has(code));
}
