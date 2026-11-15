'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {DigMark} from './brand';

// Fixed order from the handoff. Do not reorder.
const TABS = [
  {href: '/', label: 'Schedule', icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>},
  {href: '/gpa', label: 'GPA', icon: <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />},
  {href: '/dig', label: 'DIG'},
  {href: '/community', label: 'Community', icon: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />},
  {href: '/chat', label: 'Chat', icon: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />},
];

export function TabBar() {
  const pathname = usePathname();
  if (pathname.startsWith('/onboarding') || pathname === '/login') return null;
  return (
    <nav aria-label="Main" className="app-tabs fixed inset-x-0 bottom-0 z-10 mx-auto grid max-w-xl grid-cols-5 items-start rounded-t-[24px] bg-white px-2 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgba(40,20,20,0.09)]">
      {TABS.map((t) => {
        const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
        const dig = t.href === '/dig';
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-label={t.label}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-12 min-w-0 flex-col items-center gap-0.5 rounded-xl py-1 text-[10px] font-extrabold transition-colors hover:text-accent sm:text-xs ${active ? 'text-accent' : 'text-neutral-600'}`}
          >
            {dig ? (
              <span className={`-mt-7 flex size-[58px] items-center justify-center rounded-full bg-accent text-white shadow-dig transition-colors hover:bg-accent-dark ${active ? 'ring-2 ring-accent ring-offset-2' : ''}`}>
                <DigMark className="h-[30px] w-3" />
              </span>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                {t.icon}
              </svg>
            )}
            {active && <span>{t.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
