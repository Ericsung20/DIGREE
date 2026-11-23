import {degreeCreditMinimum, estimateRequirement, requirementOverlapIds, type CreditEvidence, type EstimatedGroup} from '../academic-progress';
import {useCatalogRequirements, useStudentPrograms} from './academic-catalog';
import {currentTermOf, useCourseDetails, useTerms} from './catalog';
import {useCourseRecords, useGrades} from './course-records';
import {useDarsProgress} from './degree-progress';
import {useAcademicOptions, useProfile} from './profile';
import {countedTransferCredits, useTransferCredits} from './transfer-credits';

export type ItemState = 'd' | 'p' | 'n';
export type RequirementGroup = EstimatedGroup;

export function useRequirements() {
  const profile = useProfile();
  const {programs} = useAcademicOptions();
  const selections = useStudentPrograms();
  const catalog = useCatalogRequirements(selections);
  const records = useCourseRecords();
  const grades = useGrades();
  const currentTerm = currentTermOf(useTerms());
  const program = programs.find(item => item.id === profile?.program_id);
  const dars = useDarsProgress(program?.id ?? '');
  const transfers = useTransferCredits().filter(row => !currentTerm || row.awarded_term <= currentTerm);
  const details = useCourseDetails([...records.map(row => row.course_id), ...transfers.flatMap(row => row.equivalent_course_id ? [row.equivalent_course_id] : [])]);
  const completed = records.filter(row => row.status === 'completed' && grades[row.id]?.grade !== 'F');
  const current = records.filter(row => row.status === 'enrolled_self_reported' && row.term === currentTerm);
  const credited = countedTransferCredits(transfers, new Set(completed.map(row => row.course_id)), new Set(Object.values(details).filter(course => course.repeatable).map(course => course.id)));
  const earned = completed.reduce((sum, row) => sum + row.credits, 0) + credited.reduce((sum, row) => sum + row.credits, 0);
  const inProgress = current.reduce((sum, row) => sum + row.credits, 0);
  const primary = selections.find(row => row.is_primary);
  const minimum = degreeCreditMinimum(catalog.filter(row => row.program_version_id === primary?.program_version_id));
  const codes = (id: string, fallback?: string) => details[id]?.aliases ?? [details[id]?.code ?? fallback ?? id];
  const evidence: CreditEvidence[] = [
    ...completed.map(row => ({course_id: row.course_id, codes: codes(row.course_id, row.course_code), credits: row.credits, state: 'd' as const})),
    ...credited.flatMap(row => row.equivalent_course_id ? [{course_id: row.equivalent_course_id, codes: codes(row.equivalent_course_id), credits: row.credits, state: 'd' as const, transfer: true}] : []),
    ...current.map(row => ({course_id: row.course_id, codes: codes(row.course_id, row.course_code), credits: row.credits, state: 'p' as const})),
  ];
  const groups: RequirementGroup[] = [{
    name: 'Degree credits', count: minimum ? `${earned} of ${minimum} cr · ${inProgress} now` : `${earned} cr recorded · catalog minimum needs review`,
    progress: minimum ? Math.min(1, (earned + inProgress * .5) / minimum) : 0,
    done: minimum !== null && earned >= minimum, review: minimum === null, dig: false,
    items: [
      ...completed.map(row => ({label: details[row.course_id]?.display_code ?? row.course_code ?? row.course_id, state: 'd' as const})),
      ...credited.map(row => ({label: `${row.institution} · ${row.source_course} (${row.credits} transfer cr)`, state: 'd' as const})),
      ...current.map(row => ({label: row.course_code ?? row.course_id, state: 'p' as const})),
    ],
  }];
  const overlapping = requirementOverlapIds(catalog, evidence);
  for (const group of catalog) {
    const estimate = estimateRequirement(group, evidence, overlapping.has(group.id));
    const owner = selections.find(row => row.program_version_id === group.program_version_id);
    groups.push({...estimate, name: owner ? `${owner.name} · ${estimate.name}` : estimate.name});
  }
  for (const item of dars) groups.push({
    name: item.requirement_id, count: `${item.credits_remaining} cr left in your report`, progress: item.credits_remaining === 0 ? 1 : 0,
    done: item.credits_remaining === 0, dig: false,
    items: [{label: item.credits_remaining === 0 ? 'Complete in your report' : `${item.credits_remaining} credits left in your report`, state: item.credits_remaining === 0 ? 'd' : 'n'}],
  });
  return {
    program, groups, percent: minimum ? Math.round(Math.min(1, earned / minimum) * 100) : 0,
    remaining: groups.filter(group => !group.done).length,
    totals: {now: current.length, nowCredits: inProgress, taken: completed.length, takenCredits: completed.reduce((sum, row) => sum + row.credits, 0)},
  };
}
