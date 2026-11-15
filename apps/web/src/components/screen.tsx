import Link from 'next/link';

// Shared control styles.
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
export const field = `mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 disabled:opacity-60 ${focus}`;
export const primary = `w-full rounded-xl bg-accent px-3 py-3 text-sm font-semibold text-white transition-colors enabled:hover:bg-red-900 disabled:opacity-60 ${focus}`;
export const secondary = `rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-100 disabled:opacity-60 ${focus}`;

// Page frame: title row with the profile avatar, then content above the tab bar.
export function Screen({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl bg-white px-4 pb-28 pt-5 sm:border-x sm:border-neutral-200 sm:px-8 sm:pt-8">
      <header className="mb-5 flex items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <Link href="/" className={`rounded text-xs font-bold tracking-widest text-accent ${focus}`}>DIGREE</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        </div>
        <Link
          href="/profile"
          aria-label="Profile and settings"
          className={`flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 transition-colors hover:bg-neutral-200 ${focus}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </Link>
      </header>
      {children}
    </main>
  );
}

export function EmptyState({title, body}: {title: string; body: string}) {
  return (
    <div className="mb-3 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-neutral-600">{body}</p>
    </div>
  );
}
