import Link from 'next/link';
import {AcademicProfileForm} from '@/components/academic-profile-form';
import {CourseHistory} from '@/components/course-history';
import {SignOutButton} from '@/components/onboarding-gate';
import {Chevron, Screen} from '@/components/screen';

export default async function ProfilePage({searchParams}: PageProps<'/profile'>) {
  const {planTerm} = await searchParams;
  return (
    <Screen title="Profile and settings" back={{href: '/', label: 'Back to schedule'}}>
      <Link href="/profile/requirements" className="surface mb-4 flex items-center justify-between gap-3 font-extrabold">
        Degree requirements <Chevron />
      </Link>
      <h2 className="section-title mb-2">Academic profile</h2>
      <AcademicProfileForm submitLabel="Save" />
      <h2 id="course-history" className="section-title mt-6 mb-2">Course history</h2>
      <CourseHistory key={typeof planTerm === 'string' ? planTerm : undefined} planTerm={typeof planTerm === 'string' ? planTerm : undefined} />
      <SignOutButton />
    </Screen>
  );
}
