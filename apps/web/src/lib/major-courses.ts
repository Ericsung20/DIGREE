/** Program options include university/college requirements too; these aren't major courses. */
export function isMajorRequirement(heading: string): boolean {
  const root = heading.split(' / ')[0].trim();
  return !/^(?:university\b|college\b|school\b.*degree requirements|general education\b|core general education\b|honors?\b|footnotes?\b|residen(?:ce|cy|tial)\b|quality of work\b|admission\b|how to get in\b)/i.test(root);
}
export type MajorOption = {course_code: string | null; requirement_group?: string | null; program?: string | null};
export function majorCourseRules(options: MajorOption[]): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  for (const option of options) {
    if (!option.course_code || !isMajorRequirement(option.requirement_group ?? '')) continue;
    const code = option.course_code.trim().replace(/\s+/g, ' ').toUpperCase();
    const reason = [option.program?.replace(/,.*$/, ''), option.requirement_group?.split(' / ').at(-1)].filter(Boolean).join(' · ') || 'Major requirement';
    rules.set(code, [...new Set([...(rules.get(code) ?? []), reason])]);
  }
  return rules;
}
