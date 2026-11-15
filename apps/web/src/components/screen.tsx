import Link from 'next/link';
import {Wordmark} from './brand';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
export const field = `mt-1.5 block min-h-12 w-full min-w-0 rounded-2xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm font-bold text-neutral-900 shadow-card placeholder:font-semibold placeholder:text-neutral-500 disabled:opacity-60 ${focus}`;
export const primary = `inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-accent-dark disabled:opacity-60 ${focus}`;
export const secondary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-neutral-100 px-4 py-2 text-sm font-extrabold text-neutral-900 transition-colors hover:bg-neutral-200 disabled:opacity-60 ${focus}`;
export const iconButton = `flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-neutral-100 ${focus}`;

export function Chevron({back = false}: {back?: boolean}) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={back ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}

export function Screen({title, children, home, actions, back, description}: {
  title: string;
  children: React.ReactNode;
  home?: boolean;
  actions?: React.ReactNode;
  back?: ({href: string} | {onClick: () => void}) & {label: string};
  description?: string;
}) {
  return (
    <main data-subscreen={back ? '' : undefined} className={`app-frame ${back ? 'pb-8' : 'pb-[calc(7rem+env(safe-area-inset-bottom))]'}`}>
      <header className="mb-4">
        <div className="flex min-h-12 items-center gap-1">
          {back && ('href' in back
            ? <Link href={back.href} aria-label={back.label} className={`${iconButton} -ml-2`}><Chevron back /></Link>
            : <button type="button" onClick={back.onClick} aria-label={back.label} className={`${iconButton} -ml-2`}><Chevron back /></button>)}
          {home ? (
            <Link href="/" className="mr-auto rounded px-0.5"><Wordmark className="text-[1.7rem]" /></Link>
          ) : (
            <h1 className="page-title mr-auto">{title}</h1>
          )}
          {actions}
          {!back && (
            <Link href="/profile" aria-label="Profile and settings" className={iconButton}>
              <span className="flex size-9 items-center justify-center rounded-full bg-neutral-900 text-white">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
              </span>
            </Link>
          )}
        </div>
        {home && <h1 className="sr-only">{title}</h1>}
        {description && <p className="mt-1 text-sm font-bold text-neutral-600">{description}</p>}
      </header>
      {children}
    </main>
  );
}

export function EmptyState({title, body}: {title: string; body: string}) {
  return (
    <div className="surface mb-3 flex flex-col items-center px-5 py-10 text-center">
      <p className="section-title">{title}</p>
      <p className="mt-1 max-w-64 text-sm text-neutral-600">{body}</p>
    </div>
  );
}
