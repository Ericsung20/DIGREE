import Link from 'next/link';
import {CourseHistory} from '@/components/course-history';
import {Screen, secondary} from '@/components/screen';

export default async function ScheduleCoursesPage({searchParams}: PageProps<'/schedule/courses'>) {
  const {term, view, course, from} = await searchParams;
  const semester = typeof term === 'string' ? term : '';
  const plans = view === 'plans';
  const query = new URLSearchParams();
  if (semester) query.set('term', semester);
  if (plans && from !== 'dig') query.set('view', 'plans');
  const schedule = query.size ? `/?${query}` : '/';
  const back = from === 'dig' && semester ? `/dig?term=${encodeURIComponent(semester)}` : schedule;
  return (
    <Screen title={course ? 'Edit course' : plans ? 'Planned courses' : 'Add or edit courses'} back={{href: back, label: from === 'dig' ? 'Back to DIG' : 'Back to schedule'}}>
      <CourseHistory initialTerm={semester} planTerm={plans ? semester : undefined} onlyTerm initialCourse={typeof course === 'string' ? course : undefined} />
      <Link href={back} className={`${secondary} mt-4 w-full`}>Done</Link>
    </Screen>
  );
}
