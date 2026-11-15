'use client';

import {useRouter} from 'next/navigation';
import {AcademicProfileForm} from '@/components/academic-profile-form';
import {CourseHistory} from '@/components/course-history';
import {primary} from '@/components/screen';
import {useState} from 'react';

// New-user flow: academic profile -> course history -> schedule.
export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const router = useRouter();
  return (
    <main className="app-frame py-8 sm:py-12">
        <div className="mb-5 flex items-center gap-2">
          {step === 2 && <button type="button" className="mr-2 py-2 text-sm font-extrabold text-accent" onClick={() => setStep(1)}>Back</button>}
          <span aria-hidden="true" className="h-1.5 flex-1 rounded-full bg-neutral-900" />
          <span aria-hidden="true" className={`h-1.5 flex-1 rounded-full ${step === 2 ? 'bg-neutral-900' : 'bg-neutral-200'}`} />
          <span className="ml-1 text-xs font-extrabold text-neutral-600">Step {step} of 2</span>
        </div>
      {step === 1 && (
        <>
          <h1 className="page-title mb-5">What are you studying?</h1>
          <AcademicProfileForm submitLabel="Continue" onSaved={() => setStep(2)} />
        </>
      )}
      {step === 2 && (
        <>
          <h1 className="page-title">What are you taking?</h1>
          <p className="mt-1 mb-4 text-sm text-neutral-600">You can edit your course history later in Profile.</p>
          <CourseHistory />
          <button type="button" onClick={() => router.replace('/')} className={`${primary} mt-6`}>
            Finish
          </button>
        </>
      )}
    </main>
  );
}
