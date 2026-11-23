export type ScheduleView = 'enrolled' | 'plans';
type Term = {id: string};

/** A future semester opens its saved plan unless the user explicitly chose enrollment. */
export function scheduleView(requested: string | null, term: string, current: string | null, terms: Term[]): ScheduleView {
  if (requested === 'plans' || requested === 'enrolled') return requested;
  const now = terms.findIndex(item => item.id === current);
  const selected = terms.findIndex(item => item.id === term);
  return now >= 0 && selected > now ? 'plans' : 'enrolled';
}

export function scheduleUrl(view: ScheduleView, term: string, _current: string | null, planId?: string): string {
  const query = new URLSearchParams();
  // Explicit even for the current term: a remembered future term must not win.
  if (term) query.set('term', term);
  // Preserve explicit enrollment even in a future semester.
  query.set('view', view);
  if (view === 'plans' && planId) query.set('plan', planId);
  return `/?${query}`;
}
