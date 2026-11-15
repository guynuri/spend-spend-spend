import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight, Info } from 'lucide-react';
import { cx } from '../../components/ui';
import { useParamFormatter } from '../../lib/format';
import type { Insight } from '../../../shared/domain/insights';

const ICON = { alert: AlertOctagon, warn: AlertTriangle, info: Info, good: CheckCircle2 };
const TONE = { alert: 'text-bad', warn: 'text-warn', info: 'text-accent', good: 'text-good' };

export function InsightList({ items }: { items: Insight[] }) {
  const { t } = useTranslation();
  const fmt = useParamFormatter();
  if (!items.length) return <p className="text-sm text-muted">{t('dashboard.noActions')}</p>;
  return (
    <ul className="divide-y divide-border" data-testid="insights">
      {items.map((i) => {
        const I = ICON[i.severity];
        return (
          <li key={i.id}>
            <Link to={i.href} className="flex min-h-12 items-center gap-3 py-2" data-testid="insight" data-key={i.key} data-severity={i.severity}>
              <I className={cx('size-5 shrink-0', TONE[i.severity])} aria-hidden />
              <span className="flex-1 text-sm">{t(`insights.${i.key}`, fmt(i.params))}</span>
              <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
