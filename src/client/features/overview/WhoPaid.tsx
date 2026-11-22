import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get } from '../../api';
import { Card, CardTitle } from '../../components/ui';
import { Money } from '../../components/Money';
import { formatPercent, type Locale } from '../../../shared/money';
import { slotVar } from '../../../shared/categoryLook';

interface Who {
  members: { userId: string; name: string; spentMinor: number }[];
  sharedMinor: number;
  totalMinor: number;
}
/** People get the first hues in order; "shared" is the neutral grey. */
const SLOTS = ['cat-1', 'cat-2', 'cat-3', 'cat-5', 'cat-7', 'cat-4'];

/**
 * Who paid this period (D-R28), kept simple: one thin split bar and a row per person, with "shared" for
 * joint accounts. Only for households with more than one member.
 */
export function WhoPaid() {
  const { t, i18n } = useTranslation();
  const q = useQuery({ queryKey: ['dashboard', 'who'], queryFn: () => get<Who>('/api/dashboard/who') });
  const d = q.data;
  if (!d || d.members.length < 2 || d.totalMinor <= 0) return null;
  const rows = [
    ...d.members.map((m, i) => ({ key: m.userId, name: m.name, minor: Math.max(0, m.spentMinor), slot: SLOTS[i % SLOTS.length]! })),
    ...(d.sharedMinor > 0 ? [{ key: 'shared', name: t('home.who.shared'), minor: d.sharedMinor, slot: 'cat-other' }] : []),
  ];
  const total = rows.reduce((a, r) => a + r.minor, 0) || 1;
  return (
    <Card data-testid="who-paid">
      <CardTitle>{t('home.who.title')}</CardTitle>
      <div className="mb-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={t('home.who.title')}>
        {rows
          .filter((r) => r.minor > 0)
          .map((r) => (
            <span key={r.key} className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${(r.minor / total) * 100}%`, background: slotVar(r.slot) }} />
          ))}
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.key} className="flex min-h-10 items-center gap-3 text-sm" data-testid="who-row">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: slotVar(r.slot) }} aria-hidden>
              {r.key === 'shared' ? '🤝' : r.name.trim().slice(0, 1).toUpperCase()}
            </span>
            <bdi className="min-w-0 flex-1 truncate font-medium">{r.name}</bdi>
            <span className="text-xs text-muted tabular">{formatPercent(r.minor / total, i18n.language as Locale)}</span>
            <Money minor={r.minor} decimals={0} className="w-20 text-end font-semibold" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
