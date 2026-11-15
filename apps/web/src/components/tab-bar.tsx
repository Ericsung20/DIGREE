'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';

// Fixed order from the handoff. Do not reorder.
const TABS = [
  {href: '/', label: 'Schedule', icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>},
  {href: '/gpa', label: 'GPA', icon: <path d="M3 17l6-6 4 4 8-8" />},
  {href: '/dig', label: 'DIG', icon: <path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />},
  {href: '/community', label: 'Community', icon: <path d="M4 6h16M4 12h16M4 18h10" />},
  {href: '/chat', label: 'Chat', icon: <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" />},
];

export function TabBar() {
  const pathname = usePathname();
  if (pathname.startsWith('/onboarding') || pathname === '/login') return null;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md items-end border-t border-neutral-200 bg-white px-1 pb-2 pt-1.5">
      {TABS.map((t) => {
        const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
        const dig = t.href === '/dig';
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-label={t.label}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active || dig ? 'font-semibold text-neutral-900' : 'text-neutral-600'}`}
          >
            <span className={dig ? '-mt-5 flex size-11 items-center justify-center rounded-full bg-accent text-white' : ''}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {t.icon}
              </svg>
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
