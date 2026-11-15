import type {components} from '@/lib/contract/types';
import {useBuildingNames} from '@/lib/data/catalog';
import {DAYS, byDayThenStart, minToLabel} from '@/lib/time';

type Meeting = components['schemas']['Meeting'];
export type TimetableItem = {label: string; autoAdded?: boolean; meetings: (Pick<Meeting, 'day' | 'start_min' | 'end_min'> & Partial<Pick<Meeting, 'building_id'>>)[]};

const COLORS = ['bg-sky-100 text-sky-900', 'bg-emerald-100 text-emerald-900', 'bg-amber-100 text-amber-900', 'bg-violet-100 text-violet-900', 'bg-rose-100 text-rose-900'];
const PX_PER_MIN = 0.85;

/** Week grid for a set of courses. Shared by the DIG preview and the Schedule screen. */
export function WeeklyTimetable({items, onSelect}: {items: TimetableItem[]; onSelect?: (index: number) => void}) {
  const all = items.flatMap((it) => it.meetings.map((m) => ({...m, label: it.label})));
  const buildingNames = useBuildingNames(all.flatMap((m) => m.building_id ? [m.building_id] : []));
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
      <div aria-hidden={!onSelect} className="flex pb-3 text-[11px] sm:text-xs">
        <div className="relative mt-6 w-9 shrink-0 font-bold text-neutral-500" style={{height: (end - start) * PX_PER_MIN}}>
          {hours.map((h) => (
            <span key={h} className="absolute -translate-y-1/2" style={{top: (h - start) * PX_PER_MIN}}>
              {minToLabel(h).replace(':00', '')}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="min-w-0 flex-1">
            <div className="h-6 text-center font-extrabold text-neutral-600">{d[0] + d.slice(1).toLowerCase()}</div>
            <div className="relative border-b border-neutral-200" style={{height: (end - start) * PX_PER_MIN, backgroundImage: 'linear-gradient(to bottom, var(--color-neutral-200) 1px, transparent 1px)', backgroundSize: `100% ${60 * PX_PER_MIN}px`}}>
              {items.flatMap((it, i) =>
                it.meetings
                  .filter((m) => m.day === d)
                  .map((m) => {
                    const Block = onSelect ? 'button' : 'div';
                    const shortLabel = it.label.replace(/^COMP SCI /, 'CS ');
                    const building = m.building_id ? buildingNames[m.building_id] ?? m.building_id : null;
                    const when = `${d} ${minToLabel(m.start_min)}–${minToLabel(m.end_min)}`;
                    return (
                      <Block
                        key={`${it.label}${m.start_min}`}
                        title={`${it.label}, ${when}${building ? ` · ${building}` : ''}`}
                        {...(onSelect && {type: 'button' as const, onClick: () => onSelect(i)})}
                        className={`absolute inset-x-0.5 flex flex-col justify-center overflow-hidden rounded-[10px] px-1 text-left font-black leading-tight focus-visible:z-10 sm:px-1.5 ${COLORS[i % COLORS.length]}${it.autoAdded ? ' border-2 border-dashed border-current' : ''}`}
                        style={{top: (m.start_min - start) * PX_PER_MIN, height: (m.end_min - m.start_min) * PX_PER_MIN}}
                      >
                        <span className="max-w-full break-words">{shortLabel}</span>
                        {building && m.end_min - m.start_min >= 45 && <span className="max-w-full truncate text-[10px] font-bold">{building}</span>}
                        {onSelect && <span className="sr-only">{when}, course details</span>}
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
