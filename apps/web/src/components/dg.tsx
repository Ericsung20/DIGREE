'use client';

import Link from 'next/link';
import type {CSSProperties, ReactNode} from 'react';
import {initials, useAccount} from '@/lib/data/account';
import {s} from '@/lib/ui/css';

// Shared pieces of the DIGREE screens. Markup and inline styles follow the design file (DIGREE.html)
// so each screen can be checked against its board.

/**
 * One phone screen. `css` is that screen's stylesheet from the design file; it is mounted with the
 * screen, so class names such as `.press` or `.rise` can differ from screen to screen as they do there.
 */
export function Frame({css, numeric = false, extra = '', children}: {css: string; numeric?: boolean; extra?: string; children: ReactNode}) {
  return (
    <>
      <style dangerouslySetInnerHTML={{__html: css}} />
      <div
        className="dg-frame"
        style={s(`position: relative; box-sizing: border-box; display: flex; flex-direction: column; background: #F7F5F2; color: #1D1B1A; font-family: Nunito, system-ui, sans-serif; ${numeric ? 'font-variant-numeric: tabular-nums; ' : ''}overflow: hidden; ${extra}`)}
      >
        {children}
      </div>
    </>
  );
}

export function Svg({size, sw, stroke = 'currentColor', join = true, style, children}: {size: number; sw: number; stroke?: string; join?: boolean; style?: CSSProperties; children: ReactNode}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin={join ? 'round' : undefined} aria-hidden="true" style={style}>
      {children}
    </svg>
  );
}

/** The spade: the "i" of the wordmark and the DIG mark. */
export function Spade({fill, outline = true, style, className, label}: {fill: string; outline?: boolean; style: string; className?: string; label?: string}) {
  return (
    <svg className={className} viewBox="0 0 20 52" style={s(style)} {...(label ? {role: 'img', 'aria-label': label} : {'aria-hidden': true})}>
      <circle cx="10" cy="5.5" r="5" fill={fill} />
      <rect x="6.5" y="14" width="7" height="20" rx="3.5" fill={fill} />
      <path d="M2 30H18V37C18 43 14 47.5 10 51C6 47.5 2 43 2 37Z" fill={fill} {...(outline ? {stroke: fill, strokeWidth: 2, strokeLinejoin: 'round' as const} : {})} />
    </svg>
  );
}

export function Wordmark({style, className, animatedMark = false}: {style: string; className?: string; animatedMark?: boolean}) {
  const mark = animatedMark
    ? <span className="wordmark-spade" aria-hidden="true">
        <Spade fill="#8C1D2B" style="width: 100%; height: 100%; display: block" />
        <span className="wordmark-grain wordmark-grain-left" />
        <span className="wordmark-grain wordmark-grain-right" />
      </span>
    : <Spade fill="#8C1D2B" style="height: 1.05em; width: 0.404em; vertical-align: -0.28em; margin: 0 0.03em" />;
  return (
    <span className={className} aria-label="DIGREE" style={s(style)}>
      d{mark}gree
    </span>
  );
}

/** The app icon as drawn on the log-in screen. */
export function AppIcon({className, style}: {className?: string; style: string}) {
  return (
    <svg className={className} role="img" aria-label="DIGREE app icon" viewBox="0 0 100 100" style={s(style)}>
      <defs><clipPath id="authIcon"><rect width="100" height="100" rx="26" /></clipPath></defs>
      <g clipPath="url(#authIcon)">
        <rect width="100" height="100" fill="#8C1D2B" />
        <g transform="translate(37.5 12) scale(1.25)" fill="#FFFFFF"><circle cx="10" cy="5.5" r="5" /><rect x="6.5" y="14" width="7" height="20" rx="3.5" /><path d="M2 30H18V37C18 43 14 47.5 10 51C6 47.5 2 43 2 37Z" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" /></g>
      </g>
    </svg>
  );
}

const ROUND_LINK = 'width: 44px; height: 44px; border-radius: 22px; display: flex; align-items: center; justify-content: center; color: #1D1B1A; text-decoration: none';

export function BackLink({href, label}: {href: string; label: string}) {
  return (
    <Link href={href} aria-label={label} style={s(ROUND_LINK)}>
      <Svg size={24} sw={2.6}><path d="m15 18-6-6 6-6" /></Svg>
    </Link>
  );
}

export function CloseLink({href, label}: {href: string; label: string}) {
  return (
    <Link href={href} aria-label={label} style={s(ROUND_LINK)}>
      <Svg size={22} sw={2.6} join={false}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Svg>
    </Link>
  );
}

/** The round initials button that opens Profile. */
export function AvatarLink({press = false}: {press?: boolean}) {
  const account = useAccount();
  return (
    <Link href="/profile" className={press ? 'press' : undefined} aria-label="Profile and settings" style={s('width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; text-decoration: none')}>
      <span style={s('width: 34px; height: 34px; border-radius: 17px; background: #1D1B1A; color: #FFFFFF; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center')}>
        {initials(account.name, account.email ?? '')}
      </span>
    </Link>
  );
}

export type Tab = 'schedule' | 'gpa' | 'dig' | 'community' | 'chat';
const TAB_IDLE = 'min-height: 48px; display: flex; justify-content: center; text-decoration: none; color: #6E6863';
const TAB_ACTIVE = 'min-height: 48px; display: flex; flex-direction: column; align-items: center; gap: 2px; text-decoration: none; color: #8C1D2B; font-size: 11px; font-weight: 800';
const TABS: {id: Exclude<Tab, 'dig'>; href: string; label: string; icon: ReactNode}[] = [
  {id: 'schedule', href: '/', label: 'Schedule', icon: <><rect x="3" y="4" width="18" height="18" rx="4" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>},
  {id: 'gpa', href: '/gpa', label: 'GPA', icon: <><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></>},
  {id: 'community', href: '/community', label: 'Community', icon: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />},
  {id: 'chat', href: '/chat', label: 'Chat', icon: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />},
];

/** Bottom navigation. Fixed order: Schedule, GPA, DIG, Community, Chat. */
export function TabBar({active, digHover = false, extra = ''}: {active: Tab; digHover?: boolean; extra?: string}) {
  const tab = (id: Exclude<Tab, 'dig'>) => {
    const item = TABS.find((candidate) => candidate.id === id)!;
    const on = active === id;
    return (
      <Link href={item.href} {...(on ? {'aria-current': 'page' as const} : {'aria-label': item.label})} style={s(on ? TAB_ACTIVE : TAB_IDLE)}>
        <Svg size={24} sw={on ? 2.3 : 2.2}>{item.icon}</Svg>
        {on && <span>{item.label}</span>}
      </Link>
    );
  };
  const dig = active === 'dig';
  return (
    <nav aria-label="Main" style={s(`flex-shrink: 0; height: 74px; box-sizing: border-box; padding: 8px 10px 0; background: #FFFFFF; border-radius: 24px 24px 0 0; box-shadow: 0 -6px 24px rgba(40,20,20,0.06); display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); align-items: start; ${extra}`)}>
      {tab('schedule')}
      {tab('gpa')}
      <Link href="/dig" className={digHover ? 'dig press' : undefined} {...(dig ? {'aria-current': 'page' as const} : {})} aria-label={dig ? 'DIG' : 'DIG, build a schedule'} style={s('display: flex; justify-content: center; text-decoration: none')}>
        <span style={s(`width: 58px; height: 58px; margin-top: -24px; border-radius: 29px; background: #8C1D2B; color: #FFFFFF; box-shadow: ${dig ? '0 0 0 4px #F3D9DC, ' : ''}0 8px 20px rgba(140,29,43,0.32); display: flex; align-items: center; justify-content: center`)}>
          <Spade fill="#FFFFFF" style={`height: 30px; width: 12px${digHover ? '; transform-origin: 50% 90%' : ''}`} />
        </span>
      </Link>
      {tab('community')}
      {tab('chat')}
    </nav>
  );
}

/** On/off switch used for "Compare with mine" and "Chat notifications". */
export function Switch({on, label, onToggle}: {on: boolean; label: string; onToggle: () => void}) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} style={s(`flex-shrink: 0; width: 52px; height: 32px; border-radius: 16px; border: none; padding: 4px; cursor: pointer; display: flex; transition: background 240ms ease; background: ${on ? '#1D1B1A' : '#CFCAC4'}`)}>
      <span style={s(`width: 24px; height: 24px; border-radius: 12px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(0,0,0,0.25); transition: transform 300ms cubic-bezier(.2,.9,.25,1.3); transform: translateX(${on ? 20 : 0}px)`)} />
    </button>
  );
}

/** The one line a list shows when it has nothing, in the wording style of the Community feed. */
export function EmptyNote({children, role}: {children: ReactNode; role?: 'status' | 'alert'}) {
  return <p className="rise" role={role} style={s('margin: 40px 0 0; text-align: center; font-size: 15px; font-weight: 700; color: #5F5A55')}>{children}</p>;
}

export const SR_ONLY = 'position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)';

export const ICON = {
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  down: <path d="m6 9 6 6 6-6" />,
  up: <path d="m6 15 6-6 6 6" />,
  right: <path d="m9 18 6-6-6-6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  send: <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>,
  chat: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />,
  comment: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  flag: <><path d="M4 22V4" /><path d="M4 4h12l-2 4 2 4H4" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="3" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  walk: <><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></>,
  warn: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  friends: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
};
