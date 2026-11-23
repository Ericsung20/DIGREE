import {s} from '@/lib/ui/css';
import {DAY_LETTERS} from '@/lib/ui/format';

export {gridHours} from '@/lib/week';

/** M T W T F above a week grid. */
export function DayHeads({muted = []}: {muted?: number[]}) {
  return (
    <div style={s('display: flex; padding-left: 30px; height: 24px; align-items: center')}>
      {DAY_LETTERS.map((letter, day) => (
        <span key={day} style={s(`flex: 1; text-align: center; font-size: 13px; font-weight: 800; color: ${muted.includes(day) ? '#6E6863' : '#5F5A55'}`)}>{letter}</span>
      ))}
    </div>
  );
}

/** Hour labels down the left edge, one every two hours. `H` is the height of an hour in px. */
export function HourAxis({start, end, H}: {start: number; end: number; H: number}) {
  const labels = [];
  for (let hour = start; hour < end; hour += 2) labels.push(hour);
  return (
    <div aria-hidden="true" style={s(`width: 30px; flex-shrink: 0; position: relative; height: ${(end - start) * H}px; font-size: 11px; font-weight: 700; color: #6E6863`)}>
      {labels.map((hour) => (
        <span key={hour} style={s(`position: absolute; right: 6px; top: ${(hour - start) * H - 2}px`)}>{hour % 12 || 12}</span>
      ))}
    </div>
  );
}

/** Background of one day column: a rule every two hours. */
export const dayColumn = (hours: number, H: number) =>
  `flex: 1; position: relative; height: ${hours * H}px; background-image: repeating-linear-gradient(to bottom, #EAE6E1 0, #EAE6E1 1px, transparent 1px, transparent ${H * 2}px)`;
