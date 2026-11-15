import type {components} from '@/lib/contract/types';
import {DAYS, byDayThenStart, minToLabel} from '@/lib/time';

type Meeting = components['schemas']['Meeting'];
export type TimetableItem = {label: string; meetings: Pick<Meeting, 'day' | 'start_min' | 'end_min'>[]};

const COLORS = ['bg-sky-100 text-sky-900', 'bg-emerald-100 text-emerald-900', 'bg-amber-100 text-amber-900', 'bg-violet-100 text-violet-900', 'bg-rose-100 text-rose-900'];
const PX_PER_MIN = 0.6;

/** Week grid for a set of courses. Shared by the DIG preview and the Schedule screen. */
export function WeeklyTimetable({items, onSelect}: {items: TimetableItem[]; onSelect?: (index: number) => void}) {
  const all = items.flatMap((it) => it.meetings.map((m) => ({...m, label: it.label})));
  if (all.length === 0) return <p className="text-sm text-neutral-600">No meeting times to show.</p>;

  const days = DAYS.filter((d, i) => i < 5 || all.some((m) => m.day === d));
  const start = Math.floor(Math.min(...all.map((m) => m.start_min)) / 60) * 60;
  const end = Math.ceil(Math.max(...all.map((m) => m.end_min)) / 60) * 60;
  const hours = Array.from({length: (end - start) / 60 + 1}, (_, i) => start + i * 60);

  return (
    <div>
      {/* Read-only grids are visual, so screen readers get a plain list. With onSelect the blocks are labelled buttons instead. */}
      <ul className="sr-only" hidden={!!onSelect}>
        {[...all].sort(byDayThenStart).map((m) => (
          <li key={`${m.label}${m.day}${m.start_min}`}>
            {m.label}, {m.day} {minToLabel(m.start_min)} to {minToLabel(m.end_min)}
          </li>
        ))}
      </ul>
      <div aria-hidden={!onSelect} className="flex rounded-xl border border-neutral-200 bg-neutral-50 p-2 text-[10px]">
        <div className="relative w-9 shrink-0 text-neutral-500" style={{height: (end - start) * PX_PER_MIN + 16, marginTop: 16}}>
          {hours.map((h) => (
            <span key={h} className="absolute -translate-y-1/2" style={{top: (h - start) * PX_PER_MIN}}>
              {minToLabel(h).replace(':00', '')}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="min-w-0 flex-1">
            <div className="h-4 text-center text-neutral-500">{d[0] + d.slice(1).toLowerCase()}</div>
            <div className="relative border-l border-neutral-200" style={{height: (end - start) * PX_PER_MIN, backgroundImage: 'linear-gradient(to bottom, var(--color-neutral-200) 1px, transparent 1px)', backgroundSize: `100% ${60 * PX_PER_MIN}px`}}>
              {items.flatMap((it, i) =>
                it.meetings
                  .filter((m) => m.day === d)
                  .map((m) => {
                    const Block = onSelect ? 'button' : 'div';
                    const when = `${it.label} ${minToLabel(m.start_min)}–${minToLabel(m.end_min)}`;
                    return (
                      <Block
                        key={`${it.label}${m.start_min}`}
                        title={when}
                        {...(onSelect && {type: 'button' as const, onClick: () => onSelect(i), 'aria-label': `${d} ${when}, course details`})}
                        className={`absolute inset-x-0.5 overflow-hidden rounded px-0.5 text-left font-semibold leading-tight focus-visible:outline-2 focus-visible:outline-accent ${COLORS[i % COLORS.length]}`}
                        style={{top: (m.start_min - start) * PX_PER_MIN, height: (m.end_min - m.start_min) * PX_PER_MIN}}
                      >
                        {it.label}
                      </Block>
                    );
                  }),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
