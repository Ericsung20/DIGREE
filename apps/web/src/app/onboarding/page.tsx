'use client';

import {useRouter} from 'next/navigation';
import {useState} from 'react';
import {AcademicProfileForm} from '@/components/academic-profile-form';
import {CourseHistory} from '@/components/course-history';
import {primary} from '@/components/screen';

// New-user flow: welcome -> academic profile -> course history.
export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const router = useRouter();
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 py-6">
      {step === 0 && (
        <div className="pt-24 text-center">
          <h1 className="text-3xl font-semibold">DIGREE</h1>
          <p className="mt-2 text-sm text-neutral-600">Plan your schedule around your week.</p>
          <button type="button" onClick={() => setStep(1)} className={`${primary} mt-8`}>
            Get started
          </button>
          <p className="mt-3 text-xs text-neutral-600">Demo mode. No account is created yet.</p>
        </div>
      )}
      {step === 1 && (
        <>
          <h1 className="text-lg font-semibold">Academic profile</h1>
          <p className="mb-4 text-sm text-neutral-600">Step 1 of 2</p>
          <AcademicProfileForm submitLabel="Continue" onSaved={() => setStep(2)} />
        </>
      )}
      {step === 2 && (
        <>
          <h1 className="text-lg font-semibold">Course history</h1>
          <p className="mb-4 text-sm text-neutral-600">Step 2 of 2 · You can edit this later in Profile.</p>
          <CourseHistory />
          <button type="button" onClick={() => router.push('/')} className={`${primary} mt-6`}>
            Finish
          </button>
        </>
      )}
    </main>
  );
}
