import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { post } from '../../api';
import { Button, Checkbox, ErrorState, Spinner } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { CategorySelect } from '../../components/CategorySelect';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT } from '../../lib/queries';
import { useCanWrite } from '../../lib/session';
import { useAiStatus } from './useAi';

interface Suggestion {
  key: string;
  categoryId: string;
  description: string;
  count: number;
  direction: 'in' | 'out';
}

/** AI categorization: suggestions the user reviews and applies (D-16). Hidden unless enabled. */
export function AiSuggestButton() {
  const { t } = useTranslation();
  const toast = useToast();
  const canWrite = useCanWrite();
  const s = useAiStatus();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<(Suggestion & { on: boolean })[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const fetchS = async () => {
    setOpen(true);
    setItems(null);
    setErr(null);
    try {
      const r = await post<{ suggestions: Suggestion[] }>('/api/ai/categorize');
      setItems(r.suggestions.map((x) => ({ ...x, on: true })));
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
  if (!canWrite || !s.data?.available || !s.data.enabled) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => void fetchS()} data-testid="ai-suggest">
        <Sparkles className="size-4" aria-hidden />
        {t('ai.suggest')}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('ai.suggestTitle')}
        description={t('ai.suggestBody')}
        testId="ai-suggest-sheet"
        footer={
          items && items.length > 0 ? (
            <Button busy={apply.isPending} disabled={!items.some((i) => i.on)} onClick={() => apply.mutate(undefined)} data-testid="ai-apply">
              {t('ai.apply')}
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
          <ul className="divide-y divide-border">
            {items.map((i, k) => (
              <li key={i.key} className="flex flex-col gap-1 py-2" data-testid="ai-suggestion">
                <Checkbox label={<span><bdi>{i.description}</bdi> <span className="text-xs text-muted">{t('ai.times', { count: i.count })}</span></span>} checked={i.on} onChange={(v) => setItems((xs) => xs!.map((x, j) => (j === k ? { ...x, on: v } : x)))} />
                <CategorySelect value={i.categoryId} onChange={(v) => v && setItems((xs) => xs!.map((x, j) => (j === k ? { ...x, categoryId: v } : x)))} aria-label={t('ledger.category')} />
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
