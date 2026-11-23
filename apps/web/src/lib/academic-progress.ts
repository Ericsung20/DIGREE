import {expandCourseCode} from './course-identity';
import type {CatalogRequirement} from './data/academic-catalog';

export type CreditEvidence = {course_id: string; codes: string[]; credits: number; state: 'd' | 'p'; transfer?: boolean};
export type EstimatedGroup = {
  id?: string;
  name: string; count: string; progress: number; done: boolean; dig: boolean; review?: boolean; source_url?: string;
  items: {label: string; state: 'd' | 'p' | 'n'; courseCode?: string}[];
  rules?: {id: string; kind: string; label: string; description: string; credits: string | null; conditions: string[]; courses: string[]}[];
};

export function requirementOverlapIds(groups: CatalogRequirement[], evidence: CreditEvidence[]): Set<string> {
  const canonical = new Map(evidence.flatMap(row => row.codes.flatMap(expandCourseCode).map(code => [code, row.course_id] as const)));
  const owners = new Map<string, Set<string>>();
  for (const group of groups) for (const row of group.definition.rows ?? []) {
    if (!['course', 'alternative'].includes(row.kind ?? '')) continue;
    for (const option of row.courses ?? []) for (const code of expandCourseCode(option.code)) {
      const key = `${group.program_version_id}:${canonical.get(code) ?? code}`;
      const set = owners.get(key) ?? new Set(); set.add(group.id); owners.set(key, set);
    }
  }
  return new Set([...owners.values()].filter(set => set.size > 1).flatMap(set => [...set]));
}

export function degreeCreditMinimum(groups: CatalogRequirement[]): number | null {
  const values = groups.filter(group => /degree|college/i.test(group.heading) && !/core gen|general education|requirements for the major/i.test(group.heading))
    .flatMap(group => (group.definition.rows ?? []).filter(row => /^(total credits|total degree)$/i.test(row.label ?? ''))
      .flatMap(row => [row.credits, ...(row.credit_conditions ?? [])])
      .flatMap(text => {
        const match = /^\s*(\d+)\s*(?:credits?)?\s*$/i.exec(text ?? '');
        return match ? [Number(match[1])] : [];
      }));
  return values.length ? Math.max(...values) : null;
}

/** Exact course evidence is useful even when the containing rule needs review. */
export function estimateRequirement(group: CatalogRequirement, evidence: CreditEvidence[], overlapReview = false): EstimatedGroup {
  const rows = group.definition.rows ?? [];
  const options = rows.filter(row => row.kind === 'course' || row.kind === 'alternative');
  const commands = rows.map(row => /^complete (one|two|three|four|five|six|\d+)\b/i.exec(row.label ?? '')).filter(row => row !== null);
  const command = commands[0]?.[1]?.toLowerCase();
  const numbers: Record<string, number> = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6};
  const choose = command ? numbers[command] ?? Number(command) : null;
  const plainCredits = (value: string | null | undefined) => value == null || /^\s*\d+(?:\.\d+)?(?:\s+credits?)?\s*$/i.test(value);
  const supportedRows = rows.every(row => {
    if (row.description || row.references?.length || (row.credit_conditions ?? []).some(value => !plainCredits(value)) || !plainCredits(row.credits)) return false;
    if (row.kind === 'course' || row.kind === 'alternative') return row.courses?.length === 1 && !row.label;
    return row.kind === 'criterion' && (/^complete (one|two|three|four|five|six|\d+)\s*:?\s*$/i.test(row.label ?? '') || /^total credits$/i.test(row.label ?? ''));
  });
  const simple = options.length > 0 && options.every(row => row.kind === 'course' && row.courses?.length === 1 && !row.references?.length)
    && rows.every(row => row.kind === 'course' || /^total credits$/i.test(row.label ?? ''));
  const required = choose ?? (simple ? options.length : null);
  const codes = [...new Set(options.flatMap(row => row.courses?.map(course => course.code) ?? []))];
  const used = new Set<string>();
  const items = codes.map(courseCode => {
    const wanted = new Set(expandCourseCode(courseCode));
    const matches = (row: CreditEvidence) => !used.has(row.course_id) && row.codes.flatMap(expandCourseCode).some(code => wanted.has(code));
    const found = evidence.find(row => row.state === 'd' && matches(row)) ?? evidence.find(matches);
    if (found) used.add(found.course_id);
    return {label: courseCode, courseCode, state: found?.state ?? 'n' as const};
  });
  const completed = items.filter(item => item.state === 'd').length;
  const current = items.filter(item => item.state === 'p').length;
  const earned = evidence.filter(row => row.state === 'd' && used.has(row.course_id));
  const minimumCredits = rows.filter(row => row.kind === 'criterion')
    .flatMap(row => [row.credits, ...(row.credit_conditions ?? [])]).filter(value => value != null && plainCredits(value)).map(value => parseFloat(value!));
  const availableCredits = earned.map(row => row.credits).sort((a, b) => b - a).slice(0, required ?? 0).reduce((sum, value) => sum + value, 0);
  const creditReview = completed >= (required ?? Infinity) && ((minimumCredits.length > 0 && availableCredits < Math.max(...minimumCredits))
    || options.some(row => {
      const match = row.courses?.[0];
      const rowMinima = [row.credits, ...(row.credit_conditions ?? [])].filter(value => value != null && plainCredits(value)).map(value => parseFloat(value!));
      if (!match || !rowMinima.length) return false;
      const wanted = new Set(expandCourseCode(match.code));
      const credit = earned.find(item => item.codes.flatMap(expandCourseCode).some(code => wanted.has(code)));
      return credit !== undefined && credit.credits < Math.max(...rowMinima);
    }));
  const complex = !supportedRows || creditReview || overlapReview || /residen|honors|footnote|quality of work/i.test(group.heading)
    || rows.some(row => !!row.references?.length) || commands.length > 1 || required === null || !Number.isFinite(required) || required < 1;
  return {
    id: group.id,
    name: group.heading, count: complex ? 'Needs review' : `${Math.min(completed, required!)} of ${required}${current ? ` · ${current} now` : ''}`,
    progress: required ? Math.min(1, (completed + current * .5) / required) : 0,
    done: !complex && completed >= required!, review: complex, source_url: group.source_url ?? undefined,
    items: items.length ? items : rows.flatMap(row => row.label ? [{label: `${row.label}${row.credit_conditions?.length ? ` · ${row.credit_conditions.join('; ')}` : ''}`, state: 'n' as const}] : []),
    dig: !complex && completed < required! && items.some(item => item.state === 'n'),
    // Display every published row, independently of what the estimator supports.
    rules: rows.map((row, index) => ({
      id: `${group.id}:${index}`, kind: row.kind ?? 'condition',
      label: row.label ?? (row.kind === 'alternative' ? 'Or' : ''), description: row.description ?? '',
      credits: row.credits ?? null, conditions: row.credit_conditions ?? [],
      courses: row.courses?.map(course => course.published_code ?? course.code) ?? [],
    })),
  };
}
