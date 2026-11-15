import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { Badge, Button, Card, CardTitle, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { AmountInput } from '../../components/AmountInput';
import { CategorySelect } from '../../components/CategorySelect';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { useAccounts } from '../../lib/queries';
import { useCanWrite, useMe } from '../../lib/session';
import { minorToInput, parseMoneyInput } from '../../../shared/money';
import type { RecurringDto } from '../../../shared/schemas/plan';

const KEYS = [['recurring'], ['upcoming'], ['forecast'], ['dashboard'], ['transactions']];
const KINDS: RecurringDto['kind'][] = ['expense', 'income', 'card_charge'];
const CADENCES: RecurringDto['cadence'][] = ['monthly', 'bimonthly', 'quarterly', 'yearly', 'weekly'];
const MODES: RecurringDto['amountMode'][] = ['fixed', 'estimated'];

function RecurringForm({ item, onDone }: { item: RecurringDto | null; onDone: () => void }) {
  const { t } = useTranslation();
  const today = useMe()?.active?.today ?? '';
  const accounts = (useAccounts().data?.accounts ?? []).filter((a) => !a.archived);
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<RecurringDto['kind']>(item?.kind ?? 'expense');
  const [amount, setAmount] = useState(item ? minorToInput(Math.abs(item.amountMinor)) : '');
  const [mode, setMode] = useState<RecurringDto['amountMode']>(item?.amountMode ?? 'fixed');
  const [cadence, setCadence] = useState<RecurringDto['cadence']>(item?.cadence ?? 'monthly');
  const [anchor, setAnchor] = useState(item?.anchorDate ?? today);
  const [day, setDay] = useState(String(item?.dayOfMonth ?? (Number(today.slice(8)) || 1)));
  const [end, setEnd] = useState(item?.endDate ?? '');
  const [accountId, setAccountId] = useState(item?.accountId ?? accounts.find((a) => a.includeInForecast)?.id ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(item?.categoryId ?? null);
  const [match, setMatch] = useState(item?.matchNorm ?? '');
  const minor = parseMoneyInput(amount);
  const body = {
    name: name.trim(),
    kind,
    amountMinor: Math.abs(minor ?? 0),
    amountMode: mode,
    cadence,
    dayOfMonth: cadence === 'weekly' ? null : Math.min(31, Math.max(1, Number(day) || 1)),
    anchorDate: anchor,
    endDate: end || null,
    accountId: accountId || null,
    categoryId,
    matchText: match.trim(),
  };
  const save = useApiMutation(() => (item ? patch(`/api/recurring/${item.id}`, body) : post('/api/recurring', body)), { invalidate: KEYS, onSuccess: onDone, successKey: 'ledger.saved' });
  const remove = useApiMutation(() => del(`/api/recurring/${item!.id}`), { invalidate: KEYS, onSuccess: onDone });
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('recurring.name')} htmlFor="rc-name">
        <Input id="rc-name" dir="auto" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} data-testid="recurring-name" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('recurring.kind')} htmlFor="rc-kind">
          <Select id="rc-kind" value={kind} onChange={(e) => setKind(e.target.value as RecurringDto['kind'])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`recurring.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('recurring.amount')} htmlFor="rc-amt">
          <AmountInput id="rc-amt" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="recurring-amount" placeholder="0.00" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('recurring.amountMode')} htmlFor="rc-mode">
          <Select id="rc-mode" value={mode} onChange={(e) => setMode(e.target.value as RecurringDto['amountMode'])}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(`recurring.modes.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('recurring.cadence')} htmlFor="rc-cad">
          <Select id="rc-cad" value={cadence} onChange={(e) => setCadence(e.target.value as RecurringDto['cadence'])}>
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {t(`recurring.cadences.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('recurring.anchor')} htmlFor="rc-anchor">
          <Input id="rc-anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
        </Field>
        {cadence !== 'weekly' && (
          <Field label={t('recurring.day')} htmlFor="rc-day">
            <Input id="rc-day" inputMode="numeric" dir="ltr" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} data-testid="recurring-day" />
          </Field>
        )}
      </div>
      <Field label={t('recurring.end')} htmlFor="rc-end">
        <Input id="rc-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </Field>
      <Field label={t('recurring.account')} htmlFor="rc-acc">
        <Select id="rc-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{t('recurring.anyAccount')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('recurring.category')} htmlFor="rc-cat">
        <CategorySelect id="rc-cat" value={categoryId} onChange={setCategoryId} />
      </Field>
      <Field label={t('recurring.match')} hint={t('recurring.matchHint')} htmlFor="rc-match">
        <Input id="rc-match" dir="auto" maxLength={80} value={match} onChange={(e) => setMatch(e.target.value)} />
      </Field>
      <div className="flex flex-wrap justify-between gap-2">
        {item ? (
          <Button variant="ghost" className="text-bad" onClick={() => window.confirm(t('recurring.deleteConfirm')) && remove.mutate(undefined)}>
            {t('common.delete')}
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={!name.trim() || minor === null || !anchor} busy={save.isPending} onClick={() => save.mutate(undefined)} data-testid="recurring-save">
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

function Row({ r, onOpen }: { r: RecurringDto; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex min-h-14 w-full items-center gap-3 py-2 text-start" data-testid="recurring-row" data-kind={r.kind}>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            <bdi>{r.name}</bdi>
          </div>
          <div className="text-xs text-muted">
            {t(`recurring.cadences.${r.cadence}`)} · {t(`recurring.modes.${r.amountMode}`)}
            {r.next && (
              <>
                {' '}
                · {t('recurring.next')} <DateText date={r.next.due} format="dayMonth" />
              </>
            )}
          </div>
        </div>
        <Money minor={r.next?.amountMinor ?? r.amountMinor} className={r.amountMinor > 0 ? 'font-semibold text-good' : 'font-semibold'} />
      </button>
    </li>
  );
}

export function Component() {
  const { t } = useTranslation();
  const toast = useToast();
  const canWrite = useCanWrite();
  const q = useQuery({ queryKey: ['recurring'], queryFn: () => get<{ items: RecurringDto[]; totals: { monthlyMinor: number; yearlyMinor: number } }>('/api/recurring') });
  const [editing, setEditing] = useState<RecurringDto | 'new' | null>(null);
  const setStatus = useApiMutation((v: { id: string; status: RecurringDto['status'] }) => patch(`/api/recurring/${v.id}`, { status: v.status }), { invalidate: KEYS });
  const detect = useApiMutation(() => post<{ created: number }>('/api/recurring/detect'), { invalidate: KEYS, onSuccess: (r) => toast({ title: t('recurring.detected', { count: r.created }) }) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.items;
  const sug = items.filter((i) => i.status === 'suggested');
  const active = items.filter((i) => i.status === 'active');
  const paused = items.filter((i) => i.status === 'paused');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('recurring.title')}
        actions={
          canWrite && (
            <>
              <Button variant="secondary" onClick={() => detect.mutate(undefined)} busy={detect.isPending} aria-label={t('recurring.detect')}>
                <Search className="size-5" aria-hidden />
              </Button>
              <Button onClick={() => setEditing('new')} data-testid="recurring-add">
                <Plus className="size-5" aria-hidden />
                {t('recurring.add')}
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="grid grid-cols-2 gap-3" data-testid="recurring-totals">
          <div>
            <div className="text-xs text-muted">{t('recurring.monthly')}</div>
            <Money minor={q.data.totals.monthlyMinor} decimals={0} className="text-xl font-bold" />
          </div>
          <div>
            <div className="text-xs text-muted">{t('recurring.yearly')}</div>
            <Money minor={q.data.totals.yearlyMinor} decimals={0} className="text-xl font-bold" />
          </div>
        </div>
      </Card>
      {sug.length > 0 && (
        <Card className="border-accent/40">
          <CardTitle>{t('recurring.suggested')}</CardTitle>
          <p className="mb-2 text-sm text-muted">{t('recurring.suggestedBody')}</p>
          <ul className="divide-y divide-border" data-testid="recurring-suggestions">
            {sug.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    <bdi>{r.name}</bdi>
                  </div>
                  <div className="text-xs text-muted">
                    {t(`recurring.kinds.${r.kind}`)} · {t(`recurring.cadences.${r.cadence}`)} · <Money minor={r.amountMinor} />
                  </div>
                </div>
                {canWrite && (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => setStatus.mutate({ id: r.id, status: 'active' })} data-testid="suggestion-confirm">
                      {t('recurring.confirm')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: r.id, status: 'dismissed' })}>
                      {t('recurring.dismiss')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {active.length === 0 && paused.length === 0 ? (
        <EmptyState title={t('recurring.none')} />
      ) : (
        <Card>
          <CardTitle>{t('recurring.active')}</CardTitle>
          <ul className="divide-y divide-border">
            {active.map((r) => (
              <Row key={r.id} r={r} onOpen={() => canWrite && setEditing(r)} />
            ))}
          </ul>
          {paused.length > 0 && (
            <>
              <h3 className="mt-3 text-sm font-semibold text-muted">{t('recurring.paused')}</h3>
              <ul className="divide-y divide-border opacity-70">
                {paused.map((r) => (
                  <Row key={r.id} r={r} onOpen={() => canWrite && setEditing(r)} />
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? t('recurring.add') : t('common.edit')} testId="recurring-sheet">
        {editing && (
          <>
            {editing !== 'new' && editing.lastSettled.length > 0 && (
              <div className="mb-3 rounded-xl bg-surface-2 p-3 text-sm">
                <div className="mb-1 font-medium">{t('recurring.lastCharges')}</div>
                {editing.lastSettled.map((s) => (
                  <div key={s.due} className="flex justify-between">
                    <DateText date={s.due} />
                    <Money minor={s.amountMinor} />
                  </div>
                ))}
                {editing.amountMode === 'estimated' && <p className="mt-1 text-xs text-muted">{t('recurring.estimateHelp')}</p>}
              </div>
            )}
            {editing !== 'new' && (
              <div className="mb-3 flex gap-2">
                <Badge>{t(`recurring.kinds.${editing.kind}`)}</Badge>
                <Button size="sm" variant="secondary" onClick={() => setStatus.mutate({ id: editing.id, status: editing.status === 'paused' ? 'active' : 'paused' })}>
                  {editing.status === 'paused' ? t('recurring.resume') : t('recurring.pause')}
                </Button>
              </div>
            )}
            <RecurringForm item={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
          </>
        )}
      </Sheet>
    </div>
  );
}
