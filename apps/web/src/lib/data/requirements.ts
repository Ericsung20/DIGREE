import {currentTermOf, useTerms} from './catalog';
import {useCourseRecords, useGrades} from './course-records';
import {useDarsProgress} from './degree-progress';
import {useAcademicOptions, useProfile} from './profile';

// What the app can say about degree progress from the data it has: the university-wide credit
// minimum, a small course list for the one program that has one, and whatever the student confirmed
// from DARS. It is an estimate from self-reported courses, never a degree audit.

export const DEGREE_CREDITS = 120;
/** 'd' done, 'p' in progress (taking now), 'n' still needed. */
export type ItemState = 'd' | 'p' | 'n';
export type RequirementGroup = {
  name: string;
  /** Right-hand summary, e.g. "62 of 120 cr". Ignored once the group is done. */
  count: string;
  /** 0 to 1, with courses in progress counted as half. */
  progress: number;
  done: boolean;
  items: {label: string; state: ItemState; courseCode?: string}[];
  /** True when the still-needed items are courses DIG can build a schedule around. */
  dig: boolean;
};

// The only program with a course list in the app so far (kept from the previous Degree requirements screen).
const PROGRAMMING_CORE = {program: 'Computer Sciences, BS', courses: ['COMP SCI 300', 'COMP SCI 400']};

export function useRequirements() {
  const profile = useProfile();
  const {programs} = useAcademicOptions();
  const records = useCourseRecords();
  const grades = useGrades();
  const currentTerm = currentTermOf(useTerms());
  const program = programs.find((item) => item.id === profile?.program_id);
  const dars = useDarsProgress(program?.id ?? '');

  const code = (record: (typeof records)[number]) => record.course_code ?? record.course_id;
  const completed = records.filter((record) => record.status === 'completed' && grades[record.id]?.grade !== 'F');
  const current = records.filter((record) => record.status === 'enrolled_self_reported' && record.term === currentTerm);
  const earned = completed.reduce((total, record) => total + record.credits, 0);
  const inProgress = current.reduce((total, record) => total + record.credits, 0);
  const left = Math.max(0, DEGREE_CREDITS - earned - inProgress);

  const groups: RequirementGroup[] = [{
    name: 'Degree credits',
    count: `${earned} of ${DEGREE_CREDITS} cr${inProgress ? ` · ${inProgress} now` : ''}`,
    progress: Math.min(1, (earned + inProgress * 0.5) / DEGREE_CREDITS),
    done: earned >= DEGREE_CREDITS,
    items: [
      ...completed.map((record) => ({label: code(record), state: 'd' as const})),
      ...current.map((record) => ({label: code(record), state: 'p' as const})),
      ...(left ? [{label: `${left} more credits`, state: 'n' as const}] : []),
    ],
    dig: false,
  }];

  if (program?.label === PROGRAMMING_CORE.program) {
    const items = PROGRAMMING_CORE.courses.map((course) => ({
      label: course,
      courseCode: course,
      state: (completed.some((record) => code(record) === course) ? 'd' : current.some((record) => code(record) === course) ? 'p' : 'n') as ItemState,
    }));
    const done = items.filter((item) => item.state === 'd').length;
    const now = items.filter((item) => item.state === 'p').length;
    groups.push({
      name: 'Programming core',
      count: `${done} of ${items.length}${now ? ` · ${now} now` : ''}`,
      progress: (done + now * 0.5) / items.length,
      done: done >= items.length,
      items,
      dig: items.some((item) => item.state === 'n'),
    });
  }

  // Requirements the student carried over from their DARS report, with the credits DARS says remain.
  for (const item of dars) {
    groups.push({
      name: item.requirement_id,
      count: `${item.credits_remaining} cr left`,
      progress: item.credits_remaining === 0 ? 1 : 0,
      done: item.credits_remaining === 0,
      items: [{label: item.credits_remaining === 0 ? 'Complete in DARS' : `${item.credits_remaining} credits left in DARS`, state: item.credits_remaining === 0 ? 'd' : 'n'}],
      dig: false,
    });
  }

  return {
    program,
    groups,
    percent: Math.round(Math.min(1, earned / DEGREE_CREDITS) * 100),
    remaining: groups.filter((group) => !group.done).length,
    totals: {now: current.length, nowCredits: inProgress, taken: records.filter((record) => record.status === 'completed').length, takenCredits: records.filter((record) => record.status === 'completed').reduce((total, record) => total + record.credits, 0)},
  };
}
