import type { Cal } from '../../shared/period';
import { DateText, useFormatDate } from './DateText';

/** A budget period's name; with a pay day other than the 1st, its dates too ("November 2026 · 10 Nov – 9 Dec"). */
export function PeriodLabel({ month, cal, className }: { month: string; cal: Cal; className?: string }) {
  const fmt = useFormatDate();
  return (
    <span className={className} data-testid="period-label">
      <DateText date={`${month}-01`} format="month" />
      {cal.day !== 1 && <span className="ms-1.5 text-sm font-normal text-muted">· {`${fmt(cal.start(month), 'dayMonth')} – ${fmt(cal.end(month), 'dayMonth')}`}</span>}
    </span>
  );
}
