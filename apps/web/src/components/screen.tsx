import Link from 'next/link';

// Shared control styles.
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
export const field = 'mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-900 disabled:opacity-50';
export const primary = `w-full rounded-xl bg-accent px-3 py-3 text-sm font-semibold text-white disabled:opacity-60 ${focus}`;
export const secondary = `rounded-xl border border-neutral-300 px-3 py-2 text-sm ${focus}`;

// Page frame: title row with the profile avatar, then content above the tab bar.
export function Screen({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-24 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{title}</h1>
        <Link
          href="/profile"
          aria-label="Profile and settings"
          className="flex size-8 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
    <div className="px-3 py-12 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-neutral-600">{body}</p>
    </div>
  );
}
