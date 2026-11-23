import {GRADE_POINTS, type LetterGrade} from './gpa';

export type RequisiteResult = 'met' | 'conditional' | 'unmet' | 'review';

export type PriorAttempt = {
  course_id: string;
  term: string;
  status: 'completed' | 'enrolled_self_reported';
  courses: {code: string} | null;
  grade_entries: {letter_grade: LetterGrade | null} | null;
  terms: {is_current: boolean} | null;
};

type Evidence = {
  completed: Map<string, (LetterGrade | null)[]>;
  inProgress: Set<string>;
  concurrent: Set<string>;
  undergraduate: boolean;
};

export type RecognizedTransfer = {equivalent_course_id: string | null; awarded_term: string; courses: {code: string} | null};

const normalize = (text: string) => text.replace(/[\u200b\u200c\u200d]/g, '').replace(/\s+/g, ' ').trim();
const code = (text: string) => normalize(text).toUpperCase();

export function requisiteEvidence(
  history: PriorAttempt[],
  term: string,
  aliases: ReadonlyMap<string, readonly string[]>,
  required: {id: string; code: string}[],
  undergraduate: boolean,
  transfers: RecognizedTransfer[] = [],
): Evidence {
  const evidence: Evidence = {completed: new Map(), inProgress: new Set(), concurrent: new Set(), undergraduate};
  const codesFor = (id: string, canonical?: string) => [...(aliases.get(id) ?? []), ...(canonical ? [canonical] : [])].map(code);
  for (const course of required) {
    for (const alias of codesFor(course.id, course.code)) evidence.concurrent.add(alias);
  }
  for (const record of history) {
    if (!/^\d{4}$/.test(record.term) || !/^\d{4}$/.test(term)) continue;
    const codes = codesFor(record.course_id, record.courses?.code);
    if (record.status === 'completed' && record.term < term) {
      const grade = record.grade_entries?.letter_grade ?? null;
      if (grade === 'F') continue;
      for (const alias of codes) evidence.completed.set(alias, [...(evidence.completed.get(alias) ?? []), grade]);
    }
    if (record.status === 'enrolled_self_reported' && record.terms?.is_current) {
      const group = record.term === term ? evidence.concurrent : record.term < term ? evidence.inProgress : null;
      for (const alias of codes) group?.add(alias);
    }
  }
  for (const transfer of transfers) {
    if (!transfer.equivalent_course_id || transfer.awarded_term > term) continue;
    for (const alias of codesFor(transfer.equivalent_course_id, transfer.courses?.code)) {
      // Credit equivalence supplies no UW grade or current enrollment evidence.
      evidence.completed.set(alias, [...(evidence.completed.get(alias) ?? []), null]);
    }
  }
  return evidence;
}

function all(results: RequisiteResult[]): RequisiteResult {
  return results.find(item => item === 'unmet') ?? results.find(item => item === 'review') ??
    results.find(item => item === 'conditional') ?? 'met';
}

function any(results: RequisiteResult[]): RequisiteResult {
  return results.find(item => item === 'met') ?? results.find(item => item === 'conditional') ??
    results.find(item => item === 'review') ?? 'unmet';
}

type Operator = 'and' | 'or' | ',';

/** Split only at the current level so grouped alternatives keep their scope. */
function split(text: string): {parts: string[]; operators: Operator[]; wrapped: boolean} | undefined {
  const parts: string[] = [];
  const operators: Operator[] = [];
  let depth = 0;
  let start = 0;
  let wrapped = text.startsWith('(');
  for (const token of text.matchAll(/\(|\)|,|\b(?:and|or)\b/gi)) {
    const value = token[0].toLowerCase() as Operator | '(' | ')';
    if (value === '(') { depth++; continue; }
    if (value === ')') {
      if (--depth < 0) return;
      if (depth === 0 && token.index !== text.length - 1) wrapped = false;
      continue;
    }
    if (depth) continue;
    const remainder = text.slice(token.index + token[0].length);
    if (value === 'or' && /^\s+(better|higher|above|greater)\b/i.test(remainder)) continue;
    if (value === ',' && /^\s+(and|or)\b/i.test(remainder)) continue;
    parts.push(text.slice(start, token.index).trim().replace(/,$/, '').trim());
    operators.push(value);
    start = token.index + token[0].length;
  }
  if (depth) return;
  parts.push(text.slice(start).trim());
  return {parts, operators, wrapped: wrapped && text.endsWith(')')};
}

type ParseState = {subjects?: string; lastCourse?: string[]};

function readCourse(text: string, state: ParseState): string[] | undefined {
  const match = /^([A-Z][A-Z &/-]*?)?\s*(\d{3}[A-Z]?)$/.exec(text);
  const subjects = match?.[1]?.trim() ?? state.subjects;
  if (!match || !subjects) {
    state.subjects = undefined;
    state.lastCourse = undefined;
    return;
  }
  state.subjects = subjects;
  state.lastCourse = subjects.split('/').map(subject => code(subject + ' ' + match[2]));
  return state.lastCourse;
}

function courseStatus(codes: string[], evidence: Evidence, minimum?: LetterGrade): RequisiteResult {
  const grades = codes.flatMap(alias => evidence.completed.get(alias) ?? []);
  if (grades.some(grade => minimum === undefined || (grade !== null && GRADE_POINTS[grade] >= GRADE_POINTS[minimum]))) return 'met';
  if (codes.some(alias => evidence.inProgress.has(alias))) return 'conditional';
  if (minimum && grades.includes(null)) return 'review';
  return 'unmet';
}

function evaluate(text: string, evidence: Evidence, state: ParseState, exclusion = false): RequisiteResult {
  const group = split(text);
  if (!group || group.parts.some(part => !part) || text.includes(';')) return 'review';
  if (group.wrapped) return evaluate(text.slice(1, -1).trim(), evidence, state, exclusion);

  const {parts, operators} = group;
  if (operators.length) {
    if (/^concurrent enrollment in\b/i.test(text) || (operators.includes('and') && operators.includes('or'))) {
      return 'review';
    }
    const listOperator = operators.filter(operator => operator !== ',').at(-1);
    if (!listOperator && !exclusion) return 'review';
    // Commas expand a list using its conjunction. Group mixed operators explicitly.
    const alternatives: string[][] = [[]];
    parts.forEach((part, i) => {
      alternatives.at(-1)!.push(part);
      if ((operators[i] === ',' ? listOperator ?? 'or' : operators[i]) === 'or') alternatives.push([]);
    });
    const allowShorthandConcurrency = parts.length === 2 && operators[0] === 'or';
    return any(alternatives.map(partsInAlternative => all(partsInAlternative.map(part => {
      if (/^concurrent enrollment$/i.test(part)) {
        if (!allowShorthandConcurrency || !state.lastCourse) return 'review';
        return state.lastCourse.some(alias => evidence.concurrent.has(alias)) ? 'conditional' : 'unmet';
      }
      return evaluate(part, evidence, state, exclusion);
    }))));
  }

  const concurrent = /^concurrent enrollment in (.+)$/i.exec(text);
  const minimum = /^(?:a )?(?:minimum )?grade of (AB|BC|[ABCDF])(?: or (?:better|higher|above))? in (.+)$/i.exec(text);
  const courses = readCourse(concurrent?.[1] ?? minimum?.[2] ?? text, state);
  if (courses) {
    if (concurrent) return courses.some(alias => evidence.concurrent.has(alias)) ? 'conditional' : 'unmet';
    if (exclusion) return courses.some(alias => evidence.completed.has(alias)) ? 'met' :
      courses.some(alias => evidence.inProgress.has(alias)) ? 'review' : 'unmet';
    return courseStatus(courses, evidence, minimum?.[1].toUpperCase() as LetterGrade | undefined);
  }
  if (evidence.undergraduate && /^(graduate\/professional standing|declared in (?:the )?Capstone Certificate.*)$/i.test(text)) return 'unmet';
  return 'review';
}

export function evaluateRequisites(text: string | null | undefined, evidence: Evidence): RequisiteResult {
  if (!text?.trim()) return 'review';
  const rule = normalize(text);
  if (/^none\.?$/i.test(rule)) return 'met';
  const sentences = rule.split(/\.\s+(?=Not open\b)/i);
  return all(sentences.map(sentence => {
    const clause = sentence.replace(/\.$/, '').replace(/;\s*(?=(?:and|or)\b)/gi, ' ')
      .replace(/;\s*(?=graduate\/professional standing\b|declared in (?:the )?Capstone Certificate\b)/gi, ' or ');
    const restriction = /^not open to students with credit for (.+)$/i.exec(clause);
    if (restriction) {
      const clear = evaluate(restriction[1], evidence, {}, true);
      return clear === 'met' ? 'unmet' : clear === 'unmet' ? 'met' : 'review';
    }
    return evaluate(clause, evidence, {});
  }));
}
