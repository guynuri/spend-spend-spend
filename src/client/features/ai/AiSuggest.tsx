import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { post } from '../../api';
import { Button, Checkbox, ErrorState, Spinner } from '../../components/ui';
import { Money } from '../../components/Money';
import { Sheet } from '../../components/Sheet';
import { CategorySelect } from '../../components/CategorySelect';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT } from '../../lib/queries';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../api';
import { useCanWrite } from '../../lib/session';
import { useAiStatus } from './useAi';

interface Suggestion {
  key: string;
  categoryId: string;
  description: string;
  count: number;
  amountMinor: number;
  direction: 'in' | 'out';
  confidence: number | null;
  reason: string | null;
}

/** Below this the row starts unticked: the user opts in to unsure guesses. */
const SURE = 0.7;

/** AI categorization: suggestions the user reviews; only approved rows are applied (D-16). Hidden unless enabled. */
export function AiSuggestButton() {
  const { t } = useTranslation();
  const toast = useToast();
  const canWrite = useCanWrite();
  const s = useAiStatus();
  const on0 = !!s.data?.available && !!s.data.enabled;
  // All dates, like /categorize (the nav badge counts 60 days); under 'transactions' so ledger writes refresh it.
  const uncategorized = useQuery({ queryKey: ['transactions', 'uncategorized-all'], queryFn: () => get<{ count: number }>('/api/ai/uncategorized'), enabled: canWrite && on0 }).data?.count;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<(Suggestion & { on: boolean })[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const fetchS = async () => {
    setOpen(true);
    setItems(null);
    setErr(null);
    try {
      const r = await post<{ suggestions: Suggestion[] }>('/api/ai/categorize');
      setItems(r.suggestions.map((x) => ({ ...x, on: (x.confidence ?? 1) >= SURE })));
    } catch (e) {
      setErr(e);
    }
  };
  const apply = useApiMutation(() => post<{ updated: number }>('/api/ai/categorize/apply', { items: (items ?? []).filter((i) => i.on).map((i) => ({ key: i.key, categoryId: i.categoryId, direction: i.direction })) }), {
    invalidate: [...LEDGER_DEPENDENT, ['rules'], ['ai-status']],
    onSuccess: (r) => {
      toast({ title: t('ai.applied', { count: r.updated }), tone: 'good' });
      setOpen(false);
    },
  });
  if (!canWrite || !on0 || uncategorized === 0) return null;
  const on = (items ?? []).filter((i) => i.on).length;
  const setOn = (k: number | null, v: boolean) => setItems((xs) => xs!.map((x, j) => (k === null || j === k ? { ...x, on: v } : x)));
  return (
    <>
      <Button variant="secondary" onClick={() => void fetchS()} data-testid="ai-suggest">
        <Sparkles className="size-4" aria-hidden />
        {uncategorized ? t('ai.suggestCount', { count: uncategorized }) : t('ai.suggest')}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('ai.suggestTitle')}
        description={t('ai.suggestBody')}
        testId="ai-suggest-sheet"
        footer={
          items && items.length > 0 ? (
            <Button busy={apply.isPending} disabled={!on} onClick={() => apply.mutate(undefined)} data-testid="ai-apply">
              {t('ai.applyCount', { count: on })}
            </Button>
          ) : undefined
        }
      >
        {err ? (
          <ErrorState error={err} />
        ) : !items ? (
          <Spinner />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">{t('ai.noSuggestions')}</p>
        ) : (
          <>
            <Checkbox label={t('ai.approveAll')} checked={on === items.length} onChange={(v) => setOn(null, v)} testId="ai-approve-all" />
            <ul className="divide-y divide-border">
              {items.map((i, k) => (
                <li key={i.key} className="flex flex-col gap-1 py-2" data-testid="ai-suggestion">
                  <Checkbox
                    label={
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <bdi className="font-medium">{i.description}</bdi>
                        <Money minor={i.amountMinor} className="text-sm" />
                        {i.count > 1 && <span className="text-xs text-muted">{t('ai.times', { count: i.count })}</span>}
                      </span>
                    }
                    checked={i.on}
                    onChange={(v) => setOn(k, v)}
                  />
                  <CategorySelect value={i.categoryId} onChange={(v) => v && setItems((xs) => xs!.map((x, j) => (j === k ? { ...x, categoryId: v, on: true } : x)))} aria-label={t('ledger.category')} />
                  <p className="text-xs text-muted" data-testid="ai-reason">
                    {i.confidence !== null && <span className={i.confidence < SURE ? 'text-warn' : undefined}>{t(i.confidence < SURE ? 'ai.unsure' : 'ai.sure', { pct: Math.round(i.confidence * 100) })}</span>}
                    {i.reason && <bdi> · {i.reason}</bdi>}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
    </>
  );
}
