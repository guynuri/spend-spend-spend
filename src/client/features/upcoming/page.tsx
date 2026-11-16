import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Plus, Repeat } from 'lucide-react';
import { Link } from 'react-router';
import { get, put } from '../../api';
import { Badge, Button, Card, EmptyState, ErrorState, Field, PageHeader, Spinner } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { Sheet } from '../../components/Sheet';
import { AmountInput } from '../../components/AmountInput';
import { useApiMutation } from '../../lib/mutate';
import { useCanWrite } from '../../lib/session';
import { minorToInput, parseMoneyInput } from '../../../shared/money';
import type { ForecastEvent } from '../../../shared/domain/forecast';
import { PlannedSheet } from '../recurring/Planned';

type Item = ForecastEvent & { balanceAfter: number | null };
const KEYS = [['upcoming'], ['forecast'], ['recurring'], ['dashboard']];

function OccurrenceSheet({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const sign = (item?.amountMinor ?? -1) < 0 ? -1 : 1;
  const minor = parseMoneyInput(amount);
  const ov = useApiMutation((b: { amountMinor?: number | null; skipped?: boolean }) => put(`/api/recurring/${item!.itemId}/overrides/${item!.due}`, b), { invalidate: KEYS, onSuccess: onClose });
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()} title={item?.label ?? ''} description={t('upcoming.occurrenceTitle')} testId="occurrence-sheet">
      {item && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            <DateText date={item.due ?? item.date} format="long" />
          </p>
          <Field label={t('upcoming.editAmount')} htmlFor="occ-amt">
            <AmountInput id="occ-amt" placeholder={minorToInput(Math.abs(item.amountMinor))} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="occurrence-amount" />
          </Field>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => ov.mutate({ skipped: true })} data-testid="occurrence-skip">
              {t('upcoming.skip')}
            </Button>
            <div className="flex gap-2">
              {item.overridden && (
                <Button variant="secondary" onClick={() => ov.mutate({})}>
                  {t('upcoming.resetAmount')}
                </Button>
              )}
              <Button disabled={minor === null || minor <= 0} busy={ov.isPending} onClick={() => ov.mutate({ amountMinor: sign * (minor ?? 0) })} data-testid="occurrence-save">
                {t('upcoming.save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function Component() {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const [open, setOpen] = useState<Item | null>(null);
  const [planning, setPlanning] = useState(false);
  const q = useQuery({ queryKey: ['upcoming'], queryFn: () => get<{ items: Item[]; today: string; hasForecastAccount: boolean }>('/api/upcoming?days=45') });
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of q.data?.items ?? []) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return [...m.entries()];
  }, [q.data]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('upcoming.title')}
        subtitle={t('upcoming.subtitle')}
        actions={
          <>
            <Link to="/recurring" className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-surface-2 px-3 text-sm font-medium" data-testid="upcoming-recurring" data-tour="upcoming-recurring">
              <Repeat className="size-4" aria-hidden />
              {t('upcoming.recurringLink')}
            </Link>
            {canWrite && (
              <Button onClick={() => setPlanning(true)} data-testid="upcoming-plan" data-tour="upcoming-plan">
                <Plus className="size-5" aria-hidden />
                {t('upcoming.addPlanned')}
              </Button>
            )}
          </>
        }
      />
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data.hasForecastAccount ? (
        <EmptyState icon={<CalendarClock className="size-8" aria-hidden />} title={t('forecast.noAccount')} />
      ) : groups.length === 0 ? (
        <EmptyState icon={<CalendarClock className="size-8" aria-hidden />} title={t('upcoming.empty')} />
      ) : (
        <div className="flex flex-col gap-3" data-testid="upcoming-list">
          {groups.map(([date, items]) => (
            <section key={date}>
              <h3 className="mb-1 flex justify-between px-1 text-xs font-semibold text-muted">
                <DateText date={date} format="weekday" />
                <span>
                  {t('upcoming.balanceAfter')} <Money minor={items[0]!.balanceAfter} decimals={0} className={(items[0]!.balanceAfter ?? 0) < 0 ? 'text-bad' : ''} />
                </span>
              </h3>
              <Card className="p-0">
                <ul className="divide-y divide-border">
                  {items.map((i, k) => (
                    <li key={`${i.itemId ?? i.plannedId}${k}`}>
                      <button
                        type="button"
                        disabled={!canWrite || !i.itemId}
                        onClick={() => setOpen(i)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start active:bg-surface-2 disabled:cursor-default"
                        data-testid="upcoming-item"
                        data-type={i.type}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            <bdi>{i.label}</bdi>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={i.type === 'income' ? 'good' : i.type === 'card' ? 'accent' : 'neutral'}>{t(`upcoming.types.${i.type === 'actual' ? 'recurring' : i.type}`)}</Badge>
                            {i.overridden && <Badge tone="accent">{t('upcoming.overridden')}</Badge>}
                            {i.late && <Badge tone="warn">{t('upcoming.late')}</Badge>}
                          </div>
                        </div>
                        <Money minor={i.amountMinor} className="font-semibold" tone />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
      <OccurrenceSheet item={open} onClose={() => setOpen(null)} />
      <PlannedSheet open={planning} onOpenChange={setPlanning} />
    </div>
  );
}
