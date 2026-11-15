/** Goals (PLAN §10.5). */
import { addDays, addMonths, daysBetween, monthEnd, monthOf, monthStart, type DateStr } from '../dates';
import { mean } from './common';

export interface GoalIn {
  id: string;
  name: string;
  target_minor: number;
  start_minor: number;
  start_date: DateStr;
  target_date: DateStr | null;
  priority: number;
  status: 'active' | 'completed' | 'archived';
}
export interface ContributionIn {
  goal_id: string;
  date: DateStr;
  amount_minor: number;
}
export type GoalStatus = 'completed' | 'on_track' | 'behind' | 'no_deadline';
export interface GoalView {
  id: string;
  name: string;
  targetMinor: number;
  savedMinor: number;
  progress: number;
  remainingMinor: number;
  requiredMonthlyMinor: number | null;
  expectedByNowMinor: number | null;
  status: GoalStatus;
  paceMinor: number;
  projectedFinish: DateStr | null;
  milestones: { pct: 25 | 50 | 75 | 100; date: DateStr }[];
  targetDate: DateStr | null;
  startDate: DateStr;
  priority: number;
  archived: boolean;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function goalView(g: GoalIn, contribs: ContributionIn[], T: DateStr): GoalView {
  const mine = contribs.filter((c) => c.goal_id === g.id && c.date <= T).sort((a, b) => (a.date < b.date ? -1 : 1));
  const saved = g.start_minor + mine.reduce((s, c) => s + c.amount_minor, 0);
  const progress = g.target_minor > 0 ? clamp(saved / g.target_minor, 0, 1) : 1;
  const remaining = Math.max(0, g.target_minor - saved);
  let required: number | null = null;
  let expected: number | null = null;
  if (g.target_date) {
    const monthsLeft = Math.max(1, Math.ceil(daysBetween(T, g.target_date) / 30.4375));
    required = Math.ceil(remaining / monthsLeft);
    expected = g.target_date <= g.start_date ? g.target_minor : Math.round(g.target_minor * clamp(daysBetween(g.start_date, T) / daysBetween(g.start_date, g.target_date), 0, 1));
  }
  let status: GoalStatus;
  if (saved >= g.target_minor) status = 'completed';
  else if (!g.target_date) status = 'no_deadline';
  else if (g.target_date < T) status = 'behind';
  else status = saved >= expected! - 0.05 * g.target_minor ? 'on_track' : 'behind';
  // pace: mean monthly contributions over the last 3 full months
  const cur = monthOf(T);
  const full = [1, 2, 3].map((k) => addMonths(cur, -k));
  const pace = Math.round(mean(full.map((m) => mine.filter((c) => c.date >= monthStart(m) && c.date <= monthEnd(m)).reduce((s, c) => s + c.amount_minor, 0))));
  const projectedFinish = status === 'completed' ? null : pace > 0 ? addDays(T, Math.ceil((remaining / pace) * 30.4375)) : null;
  // milestones: date of the contribution that crossed each threshold
  const milestones: GoalView['milestones'] = [];
  let run = g.start_minor;
  const cross = (pct: 25 | 50 | 75 | 100, d: DateStr) => !milestones.some((m) => m.pct === pct) && milestones.push({ pct, date: d });
  for (const p of [25, 50, 75, 100] as const) if (g.target_minor > 0 && run >= (g.target_minor * p) / 100) cross(p, g.start_date);
  for (const c of mine) {
    run += c.amount_minor;
    for (const p of [25, 50, 75, 100] as const) if (g.target_minor > 0 && run >= (g.target_minor * p) / 100) cross(p, c.date);
  }
  return {
    id: g.id,
    name: g.name,
    targetMinor: g.target_minor,
    savedMinor: saved,
    progress,
    remainingMinor: remaining,
    requiredMonthlyMinor: required,
    expectedByNowMinor: expected,
    status,
    paceMinor: pace,
    projectedFinish,
    milestones,
    targetDate: g.target_date,
    startDate: g.start_date,
    priority: g.priority,
    archived: g.status === 'archived',
  };
}

export interface GoalsSummary {
  activeCount: number;
  totalSavedMinor: number;
  totalTargetMinor: number;
  behindCount: number;
  committedMonthlyMinor: number;
  surplusMinor: number;
  pctAllocated: number | null;
  noSurplus: boolean;
}

export function goalsSummary(views: GoalView[], surplusMonthly: number): GoalsSummary {
  const active = views.filter((v) => !v.archived && v.status !== 'completed');
  const committed = active.reduce((s, v) => s + (v.requiredMonthlyMinor ?? 0), 0);
  return {
    activeCount: active.length,
    totalSavedMinor: views.filter((v) => !v.archived).reduce((s, v) => s + v.savedMinor, 0),
    totalTargetMinor: views.filter((v) => !v.archived).reduce((s, v) => s + v.targetMinor, 0),
    behindCount: active.filter((v) => v.status === 'behind').length,
    committedMonthlyMinor: committed,
    surplusMinor: Math.round(surplusMonthly),
    pctAllocated: surplusMonthly > 0 ? committed / surplusMonthly : null,
    noSurplus: surplusMonthly <= 0,
  };
}
