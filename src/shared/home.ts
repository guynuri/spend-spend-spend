/**
 * Home is a list of widgets (D-R24, D-R31). Each user picks which ones show and in what order; the
 * choice is saved on the user's profile (users.home_widgets), so it follows them to every device and
 * survives removing the app from a phone.
 */
export const HOME_WIDGETS = ['hero', 'owed', 'donut', 'who', 'attention', 'upcoming', 'forecast', 'goals', 'health', 'usual', 'budgets', 'recent'] as const;
export type HomeWidgetId = (typeof HOME_WIDGETS)[number];

/** What Home shows until the user changes it. */
export const DEFAULT_HOME: HomeWidgetId[] = ['hero', 'owed', 'donut', 'who', 'attention', 'upcoming', 'forecast', 'goals', 'health'];

const known = new Set<string>(HOME_WIDGETS);

/** A stored list, cleaned: known ids only, no repeats. Anything else (or nothing saved) gives the default. */
export function parseHomeWidgets(v: unknown): HomeWidgetId[] {
  if (!Array.isArray(v)) return DEFAULT_HOME;
  const out: HomeWidgetId[] = [];
  for (const id of v) if (typeof id === 'string' && known.has(id) && !out.includes(id as HomeWidgetId)) out.push(id as HomeWidgetId);
  return out;
}

/** Widgets not on Home, in catalogue order (the "add" list). */
export const hiddenWidgets = (shown: HomeWidgetId[]) => HOME_WIDGETS.filter((id) => !shown.includes(id));

/** Moves one item of a list from `from` to `to` (both indexes in the original list). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, x!);
  return out;
}
