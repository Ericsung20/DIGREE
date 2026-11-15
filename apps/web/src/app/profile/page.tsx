'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useState} from 'react';
import {BackLink, Frame, ICON, Svg, Switch} from '@/components/dg';
import {ProfilePrograms} from '@/components/profile-programs';
import {signOut} from '@/components/session-gate';
import {displayName, initials, useAccount} from '@/lib/data/account';
import {useStore, writeStore} from '@/lib/data/local-store';
import {useAcademicOptions, useProfile} from '@/lib/data/profile';
import {useRequirements} from '@/lib/data/requirements';
import {s} from '@/lib/ui/css';
import {plural} from '@/lib/ui/format';

const CSS = `
button{font:inherit}
a{color:#8C1D2B}a:hover{color:#6F1622}
@keyframes fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
.rise{animation:fadeUp 420ms cubic-bezier(.2,.9,.25,1) both}
.row{transition:background 200ms ease}
.row:hover{background:#FAF8F6}
.press{transition:transform 160ms ease}
.press:active{transform:scale(.98)}
`;

const C = 163.4; // circumference of the progress ring
const ROW = 'min-height: 54px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; text-decoration: none; color: #1D1B1A';
const DIVIDER = '; border-bottom: 1px solid #F1EEEA';
const GROUP = 'margin: 0; padding: 14px 16px 4px; font-size: 13px; font-weight: 800; color: #5F5A55';
const KEY = 'font-size: 15px; font-weight: 700; color: #5F5A55';
const VALUE = 'font-size: 15px; font-weight: 900; text-align: right';
// Kept on this device: the app has no notification service to register the choice with yet.
const NOTIFY = 'digree.settings.chat_notifications';

export default function ProfilePage() {
  const router = useRouter();
  const account = useAccount();
  const {colleges} = useAcademicOptions();
  const profile = useProfile();
  const {program, percent, remaining, totals} = useRequirements();
  const notify = useStore<boolean>(NOTIFY, true);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(0);

  // The ring sweeps and the number counts up to the current value, as on the design.
  useEffect(() => {
    const sweep = window.setTimeout(() => setMounted(true), 120);
    const start = Date.now() + 120;
    const timer = window.setInterval(() => {
      const t = Math.max(0, Math.min(1, (Date.now() - start) / 1000));
      setShown(Math.round(percent * (1 - Math.pow(1 - t, 3))));
      if (t >= 1) window.clearInterval(timer);
    }, 30);
    return () => {
      window.clearTimeout(sweep);
      window.clearInterval(timer);
    };
  }, [percent]);

  const edit = '/onboarding?from=profile';
  const history = '/onboarding/courses?from=profile';

  return (
    <Frame css={CSS} numeric>
      <header style={s('flex-shrink: 0; padding: 8px 20px 4px 10px; display: flex; align-items: center; gap: 4px; height: 52px')}>
        <BackLink href="/" label="Back to schedule" />
        <h1 style={s('margin: 0; font-size: 22px; font-weight: 900')}>Profile</h1>
      </header>

      <main style={s('flex: 1; min-height: 0; overflow: auto; padding: 8px 20px 24px; display: flex; flex-direction: column; gap: 12px')}>
        <section className="rise" style={s('flex-shrink: 0; display: flex; align-items: center; gap: 14px; padding: 4px 4px 8px')}>
          <span style={s('width: 68px; height: 68px; flex-shrink: 0; border-radius: 34px; background: #1D1B1A; color: #FFFFFF; font-size: 24px; font-weight: 900; display: flex; align-items: center; justify-content: center')}>{initials(account.name, account.email ?? '')}</span>
          <span style={s('display: flex; flex-direction: column; min-width: 0')}><span style={s('font-size: 24px; font-weight: 900; letter-spacing: -0.01em; overflow-wrap: anywhere')}>{displayName(account)}</span><span style={s('font-size: 14px; font-weight: 700; color: #5F5A55; overflow-wrap: anywhere')}>{account.email ?? ''}</span></span>
        </section>

        <Link href="/profile/requirements" className="rise press" style={s('flex-shrink: 0; padding: 16px; border-radius: 24px; background: #FFFFFF; box-shadow: 0 10px 28px rgba(40,20,20,0.06); text-decoration: none; color: #1D1B1A; display: flex; align-items: center; gap: 16px; animation-delay: 60ms')}>
          <svg role="img" aria-label={`${percent} percent of degree credits complete`} viewBox="0 0 64 64" style={s('width: 68px; height: 68px; flex-shrink: 0; transform: rotate(-90deg)')}>
            <circle cx="32" cy="32" r="26" fill="none" stroke="#EFEBE6" strokeWidth="8" />
            <circle cx="32" cy="32" r="26" fill="none" stroke="#8C1D2B" strokeWidth="8" strokeLinecap="round" strokeDasharray="163.4" style={s(`transition: stroke-dashoffset 1000ms cubic-bezier(.2,.9,.25,1); stroke-dashoffset: ${mounted ? C * (1 - percent / 100) : C}`)} />
          </svg>
          <span style={s('flex: 1; display: flex; flex-direction: column; gap: 2px')}><span style={s('font-size: 13px; font-weight: 800; color: #5F5A55')}>Degree requirements</span><span style={s('font-size: 22px; font-weight: 900')}>{shown}% done</span><span style={s('font-size: 13px; font-weight: 700; color: #5F5A55')}>{remaining ? `${plural(remaining, 'requirement')} left` : 'All requirements met'}</span></span>
          <Svg size={18} sw={2.8} stroke="#8A847E">{ICON.right}</Svg>
        </Link>

        <section className="rise" style={s('flex-shrink: 0; border-radius: 22px; background: #FFFFFF; overflow: hidden; animation-delay: 120ms')}>
          <h2 style={s(GROUP)}>Academic profile</h2>
          <Link href={edit} className="row" style={s(ROW + DIVIDER)}><span style={s(KEY)}>College</span><span style={s(VALUE)}>{colleges.find((college) => college.id === program?.college_id)?.label ?? '—'}</span></Link>
          <Link href={edit} className="row" style={s(ROW)}><span style={s(KEY)}>Primary major</span><span style={s(VALUE)}>{program?.label ?? '—'}</span></Link>
          {profile && <ProfilePrograms primaryId={profile.program_id} />}
        </section>

        <section className="rise" style={s('flex-shrink: 0; border-radius: 22px; background: #FFFFFF; overflow: hidden; animation-delay: 180ms')}>
          <h2 style={s(GROUP)}>Course history</h2>
          <Link href={history} className="row" style={s(ROW + DIVIDER)}><span style={s(KEY)}>Taking now</span><span style={s(VALUE)}>{plural(totals.now, 'course')} · {totals.nowCredits} cr</span></Link>
          <Link href={history} className="row" style={s(ROW)}><span style={s(KEY)}>Taken</span><span style={s(VALUE)}>{plural(totals.taken, 'course')} · {totals.takenCredits} cr</span></Link>
        </section>

        <section className="rise" style={s('flex-shrink: 0; border-radius: 22px; background: #FFFFFF; overflow: hidden; animation-delay: 240ms')}>
          <h2 style={s(GROUP)}>Settings</h2>
          <div style={s('min-height: 58px; padding: 0 10px 0 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #F1EEEA')}><span style={s('font-size: 15px; font-weight: 800')}>Chat notifications</span><Switch on={notify} label="Chat notifications" onToggle={() => writeStore(NOTIFY, !notify)} /></div>
          <button type="button" className="row" onClick={async () => {
            await signOut();
            router.replace('/login');
          }} style={s('width: 100%; border: none; background: transparent; cursor: pointer; min-height: 54px; padding: 0 16px; display: flex; align-items: center; text-decoration: none; color: #8C1D2B; font-size: 15px; font-weight: 900')}>Log out</button>
        </section>
      </main>
    </Frame>
  );
}
