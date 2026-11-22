import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { get, put } from '../../api';
import { Sheet } from '../../components/Sheet';
import { Badge, Button, Checkbox, Segmented, Select, Spinner } from '../../components/ui';
import { Money } from '../../components/Money';
import { CategoryIcon } from '../../components/CategoryIcon';
import { useApiMutation } from '../../lib/mutate';
import { useCategoryMap } from '../../lib/queries';
import { useParamFormatter } from '../../lib/format';
import { formatPercent, type Locale } from '../../../shared/money';
import { GENERAL_ID } from '../../../shared/domain/budget';
import { SAVINGS_TARGETS, type Suggestion } from '../../../shared/domain/suggest';

/**
 * "Suggest my budgets": limits from the usual months (D-R26), with the rules spelled out, a squeeze and a
 * savings target to choose, and a tick per line. Applying writes recurring limits from this period on.
 */
export function SuggestSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const pf = useParamFormatter();
  const cats = useCategoryMap();
  const [squeeze, setSqueeze] = useState<'0' | '0.05' | '0.1'>('0.05');
  const [savings, setSavings] = useState(0.1);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: ['budget', 'suggest', squeeze, savings],
    queryFn: () => get<{ suggestion: Suggestion | null; month: string }>(`/api/budgets/suggest?squeeze=${squeeze}&savings=${savings}`),
    enabled: open,
  });
  useEffect(() => setSkip(new Set()), [squeeze, savings]);
  const s = q.data?.suggestion ?? null;
  const keep = (s?.lines ?? []).filter((l) => !skip.has(l.categoryId));
  const apply = useApiMutation(
    () =>
      put('/api/budgets', {
        month: q.data!.month,
        items: keep.map((l) => (l.categoryId === GENERAL_ID ? { general: true, limitMinor: l.suggestedMinor } : l.kind === 'occasional' ? { categoryId: l.categoryId, limitMinor: l.suggestedMinor, yearly: true } : { categoryId: l.categoryId, limitMinor: l.suggestedMinor })),
      }),
    { invalidate: [['budget'], ['dashboard'], ['health'], ['me']], successKey: 'budget.suggest.applied', onSuccess: () => onOpenChange(false) },
  );
  const pct = (x: number) => formatPercent(x, i18n.language as Locale);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('budget.suggest.title')}
      testId="suggest-sheet"
      footer={
        s && (
          <Button className="w-full" disabled={!keep.length} busy={apply.isPending} onClick={() => apply.mutate(undefined)} data-testid="suggest-apply">
            {t('budget.suggest.apply', { count: keep.length })}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('budget.suggest.how')}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label={t('budget.suggest.squeeze')}
            value={squeeze}
            onChange={setSqueeze}
            options={[
              { value: '0', label: t('budget.suggest.asUsual') },
              { value: '0.05', label: '−5%' },
              { value: '0.1', label: '−10%' },
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">{t('budget.suggest.save')}</span>
            <Select value={savings} onChange={(e) => setSavings(Number(e.target.value))} className="w-24" data-testid="suggest-savings">
              {SAVINGS_TARGETS.map((v) => (
                <option key={v} value={v}>
                  {pct(v)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {q.isPending ? (
          <Spinner />
        ) : !s ? (
          <p className="rounded-2xl bg-surface-2 p-3 text-sm" data-testid="suggest-none">
            {t('budget.suggest.none')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-surface-2 p-3 text-center text-xs" data-testid="suggest-summary">
              <div>
                <p className="text-muted">{t('budget.suggest.income')}</p>
                <Money minor={s.incomeMinor} decimals={0} className="text-sm font-semibold" />
              </div>
              <div>
                <p className="text-muted">{t('budget.suggest.limits')}</p>
                <Money minor={s.totals.monthlyMinor} decimals={0} className="text-sm font-semibold" />
              </div>
              <div>
                <p className="text-muted">{t('budget.suggest.leftToSave')}</p>
                <Money minor={s.totals.leftForSavingsMinor} decimals={0} tone className="text-sm font-semibold" />
              </div>
            </div>
            {s.shortfallMinor > 0 && (
              <p className="rounded-2xl bg-warn/10 p-3 text-sm text-warn" data-testid="suggest-shortfall">
                {t('budget.suggest.shortfall', pf({ amountMinor: s.shortfallMinor }))}
              </p>
            )}
            <ul className="flex flex-col divide-y divide-border/70" data-testid="suggest-lines">
              {s.lines.map((l) => (
                <li key={l.categoryId} className="flex items-center gap-3 py-2" data-testid="suggest-line" data-kind={l.kind}>
                  <Checkbox
                    label={<span className="sr-only">{l.name}</span>}
                    checked={!skip.has(l.categoryId)}
                    onChange={(v) =>
                      setSkip((k) => {
                        const n = new Set(k);
                        if (v) n.delete(l.categoryId);
                        else n.add(l.categoryId);
                        return n;
                      })
                    }
                  />
                  <CategoryIcon cat={l.categoryId === GENERAL_ID ? { id: GENERAL_ID, color: 'cat-7', emoji: '🧺' } : cats.get(l.categoryId)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-sm font-medium">
                      <bdi className="truncate">{l.name}</bdi>
                      {l.kind !== 'everyday' && <Badge tone={l.kind === 'fixed' ? 'neutral' : 'accent'}>{t(`budget.suggest.kinds.${l.kind}`)}</Badge>}
                    </p>
                    <p className="text-xs text-muted">{t(l.kind === 'occasional' ? 'budget.suggest.usualYear' : 'budget.suggest.usual', pf({ amountMinor: l.usualMinor }))}</p>
                  </div>
                  <div className="text-end">
                    <Money minor={l.suggestedMinor} decimals={0} className="text-sm font-semibold" />
                    <p className="text-[11px] text-muted">{l.kind === 'occasional' ? t('budget.suggest.perYear') : l.scaled ? t('budget.suggest.fitted') : t('budget.suggest.perMonth')}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}

export function SuggestButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="secondary" onClick={onClick} data-testid="suggest-open">
      <Sparkles className="size-4 text-accent" aria-hidden />
      {t('budget.suggest.open')}
    </Button>
  );
}
