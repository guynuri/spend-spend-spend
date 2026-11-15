import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { post } from '../../api';
import { Sheet } from '../../components/Sheet';
import { Button, Field, Input, Segmented, Select, Textarea } from '../../components/ui';
import { AmountInput } from '../../components/AmountInput';
import { CategorySelect } from '../../components/CategorySelect';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT, useAccounts } from '../../lib/queries';
import { useMe } from '../../lib/session';
import { parseMoneyInput } from '../../../shared/money';

export function AddTxSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const today = useMe()?.active?.today ?? '';
  const accounts = (useAccounts().data?.accounts ?? []).filter((a) => !a.archived);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const minor = parseMoneyInput(amount);
  const acc = accountId || accounts[0]?.id || '';
  const create = useApiMutation(
    () => post('/api/transactions', { date, amountMinor: minor, direction, description: description.trim(), accountId: acc, categoryId, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
    {
      invalidate: [...LEDGER_DEPENDENT],
      successKey: 'ledger.saved',
      onSuccess: () => {
        setAmount('');
        setDescription('');
        setNotes('');
        setCategoryId(null);
        onOpenChange(false);
      },
    },
  );
  const ok = !!date && !!minor && minor > 0 && !!description.trim() && !!acc;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('ledger.add')}
      testId="add-tx"
      footer={
        <Button disabled={!ok} busy={create.isPending} onClick={() => create.mutate(undefined)} data-testid="add-tx-save">
          {t('common.save')}
        </Button>
      }
    >
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">{t('ledger.noAccounts')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Segmented<'out' | 'in'>
            label={t('ledger.direction')}
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'out', label: t('ledger.expense') },
              { value: 'in', label: t('ledger.income') },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('ledger.amount')} htmlFor="add-amount">
              <AmountInput id="add-amount" data-testid="add-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label={t('ledger.date')} htmlFor="add-date">
              <Input id="add-date" type="date" data-testid="add-date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label={t('ledger.description')} htmlFor="add-desc">
            <Input id="add-desc" dir="auto" data-testid="add-description" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label={t('ledger.account')} htmlFor="add-acc">
            <Select id="add-acc" value={acc} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('ledger.category')} htmlFor="add-cat">
            <CategorySelect id="add-cat" value={categoryId} onChange={setCategoryId} />
          </Field>
          <Field label={t('ledger.notes')} htmlFor="add-notes">
            <Textarea id="add-notes" dir="auto" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}
