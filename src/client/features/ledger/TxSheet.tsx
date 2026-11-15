import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, Trash2 } from 'lucide-react';
import { del, patch, post } from '../../api';
import { Sheet } from '../../components/Sheet';
import { Badge, Button, Field, Textarea } from '../../components/ui';
import { CategorySelect } from '../../components/CategorySelect';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { ConfirmSheet } from '../../components/Confirm';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT, useAccounts, useCategoryMap } from '../../lib/queries';
import { useCanWrite } from '../../lib/session';
import type { Tx } from '../../../shared/schemas/ledger';
import { SplitEditor } from './SplitEditor';
import { TxTitle } from '../../components/TxTitle';

export function TxSheet({ tx, onClose }: { tx: Tx | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const canWrite = useCanWrite();
  const cats = useCategoryMap();
  const accounts = useAccounts().data?.accounts ?? [];
  const [notes, setNotes] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [current, setCurrent] = useState<Tx | null>(tx);
  useEffect(() => {
    setCurrent(tx);
    setNotes(tx?.notes ?? '');
    setSplitting(false);
  }, [tx]);
  const undo = useApiMutation((v: { ruleId: string; txIds: string[] }) => post('/api/transactions/undo-learn', v), { invalidate: [...LEDGER_DEPENDENT] });
  const setCat = useApiMutation((categoryId: string | null) => patch<{ tx: Tx; learned: { ruleId: string; count: number; txIds: string[] } | null }>(`/api/transactions/${current!.id}`, { categoryId }), {
    invalidate: [...LEDGER_DEPENDENT],
    onSuccess: (r) => {
      setCurrent(r.tx);
      const l = r.learned;
      if (l && l.count > 0) toast({ title: t('ledger.learned', { count: l.count }), action: { label: t('common.undo'), onClick: () => undo.mutate({ ruleId: l.ruleId, txIds: l.txIds }) }, duration: 10000 });
      else if (r.tx.categoryId) toast({ title: t('ledger.learnedNone') });
    },
  });
  const saveNotes = useApiMutation((n: string) => patch<{ tx: Tx }>(`/api/transactions/${current!.id}`, { notes: n || null }), { invalidate: [['transactions']], successKey: 'ledger.saved', onSuccess: (r) => setCurrent(r.tx) });
  const remove = useApiMutation(() => del(`/api/transactions/${current!.id}`), { invalidate: [...LEDGER_DEPENDENT], onSuccess: onClose });
  const tx0 = current;
  const account = accounts.find((a) => a.id === tx0?.accountId);
  const sourceKey = tx0?.categorySource === 'rule' ? 'ledger.byRule' : tx0?.categorySource === 'ai' ? 'ledger.byAi' : tx0?.categorySource === 'user' ? 'ledger.byYou' : null;
  return (
    <Sheet open={!!tx} onOpenChange={(o) => !o && onClose()} title={splitting ? t('split.title') : t('ledger.details')} testId="tx-sheet">
      {tx0 && !splitting && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-lg font-semibold">
                <TxTitle tx={tx0} />
              </p>
              <p className="text-sm text-muted">
                <DateText date={tx0.date} format="long" /> · <span dir="auto">{account?.name}</span>
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {tx0.kind === 'card_lump' && <Badge tone="accent">{t('ledger.cardLump')}</Badge>}
                {tx0.source === 'manual' && <Badge>{t('ledger.manual')}</Badge>}
                {tx0.hasSplits && <Badge tone="accent">{t('ledger.splitBadge')}</Badge>}
              </div>
            </div>
            <Money minor={tx0.amountMinor} className="text-xl font-bold" tone signed />
          </div>
          {!tx0.hasSplits && (
            <Field label={t('ledger.category')} htmlFor="tx-cat" hint={sourceKey ? t(sourceKey) : undefined}>
              <CategorySelect id="tx-cat" data-testid="tx-category" value={tx0.categoryId} disabled={!canWrite || setCat.isPending} onChange={(v) => setCat.mutate(v)} />
            </Field>
          )}
          {tx0.hasSplits && (
            <ul className="divide-y divide-border rounded-xl border border-border" data-testid="tx-split-lines">
              {tx0.splits.map((s, i) => (
                <li key={s.id ?? i} className="flex justify-between gap-2 px-3 py-2 text-sm">
                  <span>{s.categoryId ? cats.get(s.categoryId)?.name : t('ledger.uncategorized')}</span>
                  <Money minor={s.amountMinor} tone />
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <Button variant="secondary" onClick={() => setSplitting(true)} data-testid="tx-split">
              <Scissors className="size-4" aria-hidden />
              {t('ledger.split')}
            </Button>
          )}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            {tx0.reference && (
              <>
                <dt className="text-muted">{t('ledger.reference')}</dt>
                <dd dir="ltr" className="text-end">
                  {tx0.reference}
                </dd>
              </>
            )}
            {tx0.operationType && (
              <>
                <dt className="text-muted">{t('ledger.operationType')}</dt>
                <dd dir="auto" className="text-end">
                  {tx0.operationType}
                </dd>
              </>
            )}
            {tx0.valueDate && tx0.valueDate !== tx0.date && (
              <>
                <dt className="text-muted">{t('ledger.valueDate')}</dt>
                <dd className="text-end">
                  <DateText date={tx0.valueDate} />
                </dd>
              </>
            )}
            {tx0.balanceAfterMinor !== null && (
              <>
                <dt className="text-muted">{t('ledger.balanceAfter')}</dt>
                <dd className="text-end">
                  <Money minor={tx0.balanceAfterMinor} />
                </dd>
              </>
            )}
          </dl>
          <Field label={t('ledger.notes')} htmlFor="tx-notes">
            <Textarea id="tx-notes" dir="auto" maxLength={500} value={notes} disabled={!canWrite} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {canWrite && (
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" className="text-bad" onClick={() => setConfirmDel(true)}>
                <Trash2 className="size-4" aria-hidden />
                {t('common.delete')}
              </Button>
              <Button variant="secondary" disabled={notes === (tx0.notes ?? '')} busy={saveNotes.isPending} onClick={() => saveNotes.mutate(notes)}>
                {t('ledger.notesSave')}
              </Button>
            </div>
          )}
        </div>
      )}
      {tx0 && splitting && (
        <SplitEditor
          tx={tx0}
          onDone={() => {
            setSplitting(false);
            onClose();
          }}
        />
      )}
      <ConfirmSheet open={confirmDel} onOpenChange={setConfirmDel} title={t('ledger.deleteConfirm')} confirmLabel={t('common.delete')} onConfirm={() => remove.mutateAsync(undefined).then(() => undefined)} />
    </Sheet>
  );
}
