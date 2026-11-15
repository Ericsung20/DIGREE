import Image from 'next/image';

export function DigMark({className}: {className?: string}) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 52" className={className} fill="currentColor">
      <circle cx="10" cy="5.5" r="5" />
      <rect x="6.5" y="14" width="7" height="20" rx="3.5" />
      <path d="M2 30h16v7c0 6-4 10.5-8 14-4-3.5-8-8-8-14z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({className = ''}: {className?: string}) {
  return (
    <span className={`inline-flex items-baseline font-black leading-none tracking-[-0.03em] ${className}`}>
      <span className="sr-only">DIGREE</span>
      <span aria-hidden="true">d<DigMark className="mx-[0.03em] inline-block h-[1.05em] w-[0.404em] align-[-0.28em] text-accent" />gree</span>
    </span>
  );
}

export function AuthBrand() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <Image alt="" src="/digree-icon.svg" width={92} height={92} className="rounded-[24px] shadow-dig" />
      <h1><Wordmark className="text-[2.75rem]" /></h1>
      <p className="text-base font-bold text-neutral-600">Classes, schedules and GPA for UW–Madison</p>
    </div>
  );
}
