'use client';

import {useRouter, useSearchParams} from 'next/navigation';
import {Suspense, useState} from 'react';
import {EmptyNote, Frame, Svg} from '@/components/dg';
import {signOut} from '@/components/session-gate';
import {latestCatalogEdition, saveProfile, useAcademicOptions, useProfile} from '@/lib/data/profile';
import {s} from '@/lib/ui/css';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 420ms cubic-bezier(.2,.9,.25,1) both}
.press{transition:transform 160ms ease, background 200ms ease}
.press:active{transform:scale(.97)}
`;

type Draft = {college: string | null; major: string | null; step: number};
const EMPTY: Draft = {college: null, major: null, step: 0};

// Step 1 of 2 for a new account, and the editor behind the Academic profile rows on Profile.
function AcademicProfile() {
  const router = useRouter();
  const fromProfile = useSearchParams().get('from') === 'profile';
  const saved = useProfile();
  const {colleges, programs: all, ready} = useAcademicOptions();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const savedProgram = all.find((program) => program.id === saved?.program_id);
  const v = draft ?? (savedProgram ? {college: savedProgram.college_id, major: savedProgram.label, step: 2} : EMPTY);
  const inCollege = all.filter((program) => program.college_id === v.college);
  const editions = inCollege.filter((program) => program.label === v.major);
  const chosen = editions.find((program) => program.id === saved?.program_id) ?? latestCatalogEdition(editions);
  const lists = [
    colleges.filter((college) => all.some((program) => program.college_id === college.id)).map((college) => ({id: college.id, label: college.label})),
    [...new Set(inCollege.map((program) => program.label))].map((label) => ({id: label, label})),
  ];
  const picks = [v.college, v.major];
  const labels = ['College', 'Major'];
  const placeholders = ['Choose your college', v.college === null ? 'Pick a college first' : 'Choose your major'];
  const unavailable = ready && all.length === 0;
  const done = !!chosen || unavailable;

  function pick(i: number, id: string) {
    setError(false);
    if (i === 0) {
      setDraft({college: id, major: id === v.college ? v.major : null, step: 1});
    } else {
      setDraft({...v, major: id, step: 2});
    }
  }

  async function next() {
    if (busy) return;
    const onward = fromProfile ? '/profile' : '/onboarding/courses';
    if (!chosen || chosen.id === saved?.program_id) return router.push(onward);
    setBusy(true);
    setError(false);
    try {
      await saveProfile({college_id: chosen.college_id, program_id: chosen.id, catalog_year: chosen.catalog_year});
      router.push(onward);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function back() {
    if (fromProfile) return router.push('/profile');
    await signOut(); // step 1 comes right after sign-up, so going back means leaving the account
    router.replace('/login');
  }

  return (
    <Frame css={CSS}>
      <header style={s('flex-shrink: 0; padding: 8px 20px 4px 10px; display: flex; flex-direction: column; gap: 14px')}>
        <div style={s('display: flex; align-items: center; gap: 10px; height: 44px')}>
          <button type="button" onClick={() => void back()} aria-label="Back" style={s('width: 44px; height: 44px; border: none; background: transparent; cursor: pointer; border-radius: 22px; display: flex; align-items: center; justify-content: center; color: #1D1B1A; text-decoration: none; padding: 0')}><Svg size={24} sw={2.6}><path d="m15 18-6-6 6-6" /></Svg></button>
          <div aria-label="Step 1 of 2" style={s('flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px')}>
            <span style={s('height: 6px; border-radius: 3px; background: #1D1B1A')} />
            <span style={s('height: 6px; border-radius: 3px; background: #E1DCD6')} />
          </div>
          <span style={s('font-size: 13px; font-weight: 800; color: #5F5A55; padding-right: 4px')}>1 / 2</span>
        </div>
        <h1 style={s('margin: 0; padding-left: 10px; font-size: 32px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1')}>What are you studying?</h1>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 18px 20px 16px; display: flex; flex-direction: column; gap: 10px')}>
        {!unavailable && labels.map((label, i) => {
          const open = v.step === i;
          const picked = picks[i] !== null && lists[i].some((option) => option.id === picks[i]);
          return (
            <section key={label} style={s(`flex-shrink: 0; border-radius: 22px; overflow: hidden; transition: background 260ms ease, box-shadow 260ms ease; ${open ? 'background: #FFFFFF; box-shadow: 0 10px 28px rgba(40,20,20,0.08)' : 'background: #FFFFFF; box-shadow: 0 1px 3px rgba(40,20,20,0.06)'}`)}>
              <button type="button" onClick={() => {
                if (i === 0 || picks[i - 1] !== null) setDraft({...v, step: i});
              }} aria-expanded={open} style={s('width: 100%; min-height: 56px; border: none; background: transparent; padding: 0 16px; display: flex; align-items: center; gap: 12px; color: #1D1B1A; cursor: pointer; text-align: left')}>
                <span style={s(`width: 30px; height: 30px; border-radius: 15px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 900; ${picked && !open ? 'background: #1D1B1A; color: #FFFFFF' : open ? 'background: #1D1B1A; color: #FFFFFF' : 'background: #ECE8E3; color: #5F5A55'}`)}>{picked && !open ? '✓' : String(i + 1)}</span>
                <span style={s('flex: 1; display: flex; flex-direction: column')}><span style={s('font-size: 13px; font-weight: 800; color: #5F5A55')}>{label}</span><span style={s('font-size: 16px; font-weight: 900')}>{picked ? lists[i].find((option) => option.id === picks[i])!.label : ready ? placeholders[i] : 'Loading…'}</span></span>
              </button>
              {open && (
                <div className="rise" style={s('padding: 0 10px 12px; display: flex; flex-direction: column; gap: 4px')}>
                  {lists[i].map((option) => {
                    const on = picks[i] === option.id;
                    return (
                      <button key={option.id} type="button" className="press" aria-pressed={on} onClick={() => pick(i, option.id)} style={s(`min-height: 48px; padding: 0 14px; border: none; border-radius: 14px; text-align: left; font-size: 15px; font-weight: 800; cursor: pointer; ${on ? 'background: #1D1B1A; color: #FFFFFF' : 'background: transparent; color: #1D1B1A'}`)}>{option.label}</button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {unavailable && <EmptyNote>Academic programs aren’t available yet. You can keep going and add your courses.</EmptyNote>}
        {error && <EmptyNote role="alert">Couldn’t save your profile. Try again.</EmptyNote>}
      </main>

      <div style={s('flex-shrink: 0; padding: 10px 20px 28px')}>
        {done
          ? <button type="button" onClick={() => void next()} disabled={busy} className="press" style={s('width: 100%; border: none; cursor: pointer; height: 58px; border-radius: 22px; background: #8C1D2B; color: #FFFFFF; text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; box-shadow: 0 8px 20px rgba(140,29,43,0.30)')}>Continue</button>
          : <span aria-disabled="true" style={s('height: 58px; border-radius: 22px; background: #E4DFD9; color: #6E6863; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900')}>Continue</span>}
      </div>
    </Frame>
  );
}

export default function OnboardingPage() {
  return <Suspense fallback={<Frame css={CSS}><span /></Frame>}><AcademicProfile /></Suspense>;
}
