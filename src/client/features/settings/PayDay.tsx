import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { patch } from '../../api';
import { Button, Card, CardTitle, Segmented, Select } from '../../components/ui';
import { useFormatDate } from '../../components/DateText';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT } from '../../lib/queries';
import { useIsOwner, useMe } from '../../lib/session';
import { makeCal, MAX_START_DAY, MIN_START_DAY } from '../../../shared/period';

/** Pay day: budget months start on this day; statistics follow it or calendar months (owner only). */
export function PayDayCard() {
  const { t } = useTranslation();
  const fmt = useFormatDate();
  const me = useMe();
  const owner = useIsOwner();
  const a = me?.active;
  const [day, setDay] = useState(a?.periodStartDay ?? 1);
  const [stats, setStats] = useState<'period' | 'calendar'>(a?.statsByPeriod === false ? 'calendar' : 'period');
  const save = useApiMutation(() => patch('/api/household', { periodStartDay: day, statsByPeriod: stats === 'period' }), {
    invalidate: [['me'], ['household'], ...LEDGER_DEPENDENT],
    successKey: 'ledger.saved',
  });
  if (!a) return null;
  const cal = makeCal(day);
  const cur = cal.of(a.today);
  const changed = day !== (a.periodStartDay ?? 1) || (stats === 'period') !== (a.statsByPeriod !== false);
  return (
    <Card data-testid="payday-card">
      <CardTitle>
        <span className="flex items-center gap-2">
          <CalendarDays className="size-5 text-accent" aria-hidden />
          {t('settings.payday.title')}
        </span>
      </CardTitle>
      <p className="mb-3 text-sm text-muted">{t('settings.payday.body')}</p>
      <label className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t('settings.payday.day')}</span>
        <Select value={day} disabled={!owner} onChange={(e) => setDay(Number(e.target.value))} className="w-40" data-testid="payday-day">
          {Array.from({ length: MAX_START_DAY - MIN_START_DAY + 1 }, (_, i) => i + MIN_START_DAY).map((d) => (
            <option key={d} value={d}>
              {d === 1 ? t('settings.payday.calendar') : t('settings.payday.nth', { day: d })}
            </option>
          ))}
        </Select>
      </label>
      <p className="mb-3 rounded-2xl bg-surface-2 p-3 text-sm" data-testid="payday-example">
        {t('settings.payday.example', { from: fmt(cal.start(cur), 'dayMonth'), to: fmt(cal.end(cur), 'dayMonth'), month: fmt(`${cur}-01`, 'month') })}
      </p>
      {day !== 1 && (
        <div className="mb-3 flex flex-col gap-2">
          <span className="text-sm font-medium">{t('settings.payday.stats')}</span>
          <Segmented
            label={t('settings.payday.stats')}
            value={stats}
            onChange={(v) => owner && setStats(v)}
            options={[
              { value: 'period', label: t('settings.payday.statsPeriod') },
              { value: 'calendar', label: t('settings.payday.statsCalendar') },
            ]}
          />
          <p className="text-xs text-muted">{t('settings.payday.statsHint')}</p>
        </div>
      )}
      {owner ? (
        <div className="flex justify-end">
          <Button disabled={!changed} busy={save.isPending} onClick={() => save.mutate(undefined)} data-testid="payday-save">
            {t('common.save')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted">{t('settings.payday.ownerOnly')}</p>
      )}
    </Card>
  );
}
