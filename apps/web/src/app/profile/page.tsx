import {AcademicProfileForm} from '@/components/academic-profile-form';
import {CourseHistory} from '@/components/course-history';
import {SignOutButton} from '@/components/onboarding-gate';
import {Screen} from '@/components/screen';

export default function ProfilePage() {
  return (
    <Screen title="Profile and settings">
      <h2 className="mb-2 text-sm font-semibold">Academic profile</h2>
      <AcademicProfileForm submitLabel="Save" />
      <h2 className="mb-2 mt-8 text-sm font-semibold">Course history</h2>
      <CourseHistory />
      <SignOutButton />
    </Screen>
  );
}
