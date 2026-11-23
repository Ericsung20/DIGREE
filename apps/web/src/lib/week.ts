type Slot = {start_min: number; end_min: number};
/** Frame the actual classes with a little breathing room; empty weeks retain a daytime grid. */
export function gridHours(meetings: Slot[]): {start: number; end: number} {
  if (!meetings.length) return {start: 8, end: 17};
  const start = Math.max(0, Math.floor((Math.min(...meetings.map(meeting => meeting.start_min)) - 30) / 60));
  const end = Math.min(24, Math.ceil((Math.max(...meetings.map(meeting => meeting.end_min)) + 30) / 60));
  return {start, end};
}
