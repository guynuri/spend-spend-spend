import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { Badge, Button, Card, CardTitle, Field, Input, Segmented, Select } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { AmountInput } from '../../components/AmountInput';
import { CategorySelect } from '../../components/CategorySelect';
import { useApiMutation } from '../../lib/mutate';
import { useAccounts } from '../../lib/queries';
import { useCanWrite, useMe } from '../../lib/session';
import { parseMoneyInput } from '../../../shared/money';
import type { PlannedDto, RecurringDto } from '../../../shared/schemas/plan';

const PLAN_KEYS = [['planned'], ['forecast'], ['upcoming'], ['dashboard']];

export function PlannedSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const today = useMe()?.active?.today ?? '';
  const accounts = (useAccounts().data?.accounts ?? []).filter((a) => !a.archived);
  const cards = (useQuery({ queryKey: ['recurring'], queryFn: () => get<{ items: RecurringDto[] }>('/api/recurring') }).data?.items ?? []).filter((r) => r.kind === 'card_charge' && r.status === 'active');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [payFrom, setPayFrom] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const minor = parseMoneyInput(amount);
  const from = payFrom || (accounts.find((a) => a.includeInForecast)?.id ? `acc:${accounts.find((a) => a.includeInForecast)!.id}` : '');
  const save = useApiMutation(
    () =>
      post('/api/planned', {
        name: name.trim(),
        amountMinor: minor,
        direction: dir,
        date,
        categoryId,
        ...(from.startsWith('card:') ? { cardRecurringId: from.slice(5) } : from.startsWith('acc:') ? { accountId: from.slice(4) } : {}),
      }),
    {
      invalidate: PLAN_KEYS,
      successKey: 'ledger.saved',
      onSuccess: () => {
        setName('');
        setAmount('');
        onOpenChange(false);
      },
    },
  );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('planned.add')}
      testId="planned-sheet"
      footer={
        <Button disabled={!name.trim() || !minor || minor <= 0 || !date} busy={save.isPending} onClick={() => save.mutate(undefined)} data-testid="planned-save">
          {t('common.save')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented<'out' | 'in'> label={t('ledger.direction')} value={dir} onChange={setDir} options={[{ value: 'out', label: t('ledger.expense') }, { value: 'in', label: t('ledger.income') }]} />
        <Field label={t('planned.name')} htmlFor="pl-name">
          <Input id="pl-name" dir="auto" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} data-testid="planned-name" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('planned.amount')} htmlFor="pl-amt">
            <AmountInput id="pl-amt" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="planned-amount" placeholder="0.00" />
          </Field>
          <Field label={t('planned.date')} htmlFor="pl-date">
            <Input id="pl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="planned-date" />
          </Field>
        </div>
        <Field label={t('planned.payFrom')} htmlFor="pl-from" hint={from.startsWith('card:') ? t('planned.cardHint') : undefined}>
          <Select id="pl-from" value={from} onChange={(e) => setPayFrom(e.target.value)} data-testid="planned-from">
            {accounts.map((a) => (
              <option key={a.id} value={`acc:${a.id}`}>
                {a.name}
              </option>
            ))}
            {cards.map((c) => (
              <option key={c.id} value={`card:${c.id}`}>
                {t('planned.card')}: {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('ledger.category')} htmlFor="pl-cat">
          <CategorySelect id="pl-cat" value={categoryId} onChange={setCategoryId} />
        </Field>
      </div>
    </Sheet>
  );
}

export function PlannedList() {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['planned'], queryFn: () => get<{ planned: PlannedDto[] }>('/api/planned') });
  const setStatus = useApiMutation((v: { id: string; status: PlannedDto['status'] }) => patch(`/api/planned/${v.id}`, { status: v.status }), { invalidate: PLAN_KEYS });
  const remove = useApiMutation((id: string) => del(`/api/planned/${id}`), { invalidate: PLAN_KEYS });
  const items = q.data?.planned ?? [];
  return (
    <Card>
      <CardTitle
        action={
          canWrite && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)} data-testid="planned-add">
              <Plus className="size-4" aria-hidden />
              {t('planned.add')}
            </Button>
          )
        }
      >
        {t('planned.title')}
      </CardTitle>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('planned.empty')}</p>
      ) : (
        <ul className="divide-y divide-border text-sm" data-testid="planned-list">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="font-medium">
                  <bdi>{p.name}</bdi>
                </div>
                <div className="text-xs text-muted">
                  <DateText date={p.date} /> · <Badge tone={p.status === 'planned' ? 'accent' : 'neutral'}>{t(`planned.status.${p.status}`)}</Badge>
                </div>
              </div>
              <Money minor={p.amountMinor} />
              {canWrite && p.status === 'planned' && (
                <div className="flex w-full justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: p.id, status: 'done' })}>
                    {t('planned.markDone')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: p.id, status: 'cancelled' })}>
                    {t('planned.cancel')}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-bad" onClick={() => remove.mutate(p.id)}>
                    {t('common.delete')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <PlannedSheet open={adding} onOpenChange={setAdding} />
    </Card>
  );
}
