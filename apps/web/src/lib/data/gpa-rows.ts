import {summarize, type GpaRow, type LetterGrade} from '../gpa';
import {useTerms} from './catalog';
import {useCourseRecords, useGrades, type CourseRecord} from './course-records';

export type GradedRecord = CourseRecord & {grade: LetterGrade | null; final: boolean};

/**
 * Course records joined with their grades, and the GPA summary built from them.
 * A grade marked final counts toward the cumulative GPA; a projected one shows in its own term only.
 * A course with no grade yet follows its record: finished courses are final, current ones projected.
 */
export function useGpa() {
  const records = useCourseRecords();
  const grades = useGrades();
  const terms = useTerms();
  const rows: GradedRecord[] = records
    .filter((record) => record.status === 'completed' || record.status === 'enrolled_self_reported')
    .map((record) => ({...record, grade: grades[record.id]?.grade ?? null, final: grades[record.id]?.final ?? record.status === 'completed'}));
  const forSummary: GpaRow[] = rows.map((row) => ({term: row.term, credits: row.credits, grade: row.grade, major: row.counts_toward_major, status: row.final ? 'completed' : 'enrolled_self_reported'}));
  return {rows, terms, summary: summarize(forSummary, terms.map((term) => term.id))};
}
