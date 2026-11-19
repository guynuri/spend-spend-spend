import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, Plus } from 'lucide-react';
import { del, patch, post } from '../../api';
import { Badge, Button, Card, Checkbox, cx, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { AmountInput } from '../../components/AmountInput';
import { ExplainSheet } from '../../components/ExplainSheet';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT, useAccounts } from '../../lib/queries';
import { useCanWrite, useMe } from '../../lib/session';
import { minorToInput, parseMoneyInput } from '../../../shared/money';
import type { Account } from '../../../shared/schemas/ledger';
import { BANKS } from '../../../shared/banks';
import { BankBadge, BankLink, useBankName } from '../../components/BankBadge';

const TYPES: Account['type'][] = ['checking', 'savings', 'cash', 'credit_card', 'investment'];

function AccountForm({ account, onDone }: { account: Account | null; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<Account['type']>(account?.type ?? 'checking');
  const [bank, setBank] = useState(account?.bankId ?? (account?.institution ? 'other' : ''));
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const bankName = useBankName();
  const [mask, setMask] = useState(account?.accountMask ?? '');
  const [opening, setOpening] = useState(account ? minorToInput(account.openingBalanceMinor) : '');
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? '');
  const [forecast, setForecast] = useState(account?.includeInForecast ?? true);
  const [liquid, setLiquid] = useState(account?.isLiquid ?? true);
  const openingMinor = opening.trim() ? parseMoneyInput(opening) : 0;
  const body = { name: name.trim(), type, bankId: bank && bank !== 'other' ? bank : null, institution: bank === 'other' ? institution.trim() : '', accountMask: mask || undefined, openingBalanceMinor: openingMinor ?? 0, openingDate: openingDate || null, includeInForecast: forecast, isLiquid: liquid };
  const save = useApiMutation(() => (account ? patch(`/api/accounts/${account.id}`, body) : post('/api/accounts', body)), { invalidate: [...LEDGER_DEPENDENT], onSuccess: onDone, successKey: 'ledger.saved' });
  const remove = useApiMutation(() => del<{ archived?: boolean }>(`/api/accounts/${account!.id}`), {
    invalidate: [...LEDGER_DEPENDENT],
    onSuccess: (r) => {
      toast({ title: t(r.archived ? 'accounts.archivedToast' : 'accounts.deleted') });
      onDone();
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <Field label={t('accounts.name')} htmlFor="acc-name">
        <Input id="acc-name" dir="auto" data-testid="account-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('accounts.type')} htmlFor="acc-type">
        <Select
          id="acc-type"
          data-testid="account-type"
          value={type}
          onChange={(e) => {
            const next = e.target.value as Account['type'];
            setType(next);
            // An investment account is neither cash-flow nor emergency money by default (also when an
            // existing account is converted); the boxes stay visible and editable before saving.
            if (next === 'investment' && type !== 'investment') {
              setForecast(false);
              setLiquid(false);
            }
          }}
        >
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`accounts.types.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      {type === 'investment' && (
        <p className="text-xs text-muted" data-testid="investment-hint">
          {t('accounts.investmentHint')}
        </p>
      )}
      {type === 'credit_card' && (
        <p className="text-xs text-muted" data-testid="card-hint">
          {t('accounts.cardHint')}
        </p>
      )}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t('accounts.institution')}</legend>
        <div className="flex flex-wrap gap-1.5" data-testid="bank-picker">
          {[...BANKS.map((b) => b.id), 'other'].map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={bank === id}
              onClick={() => setBank(bank === id ? '' : id)}
              className={cx('inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-2 text-xs', bank === id ? 'border-accent bg-accent/10 font-semibold' : 'border-border')}
              data-testid={`bank-${id}`}
            >
              {id === 'other' ? t('accounts.otherBank') : <><BankBadge bankId={id} />{bankName({ bankId: id })}</>}
            </button>
          ))}
        </div>
        {bank === 'other' && <Input aria-label={t('accounts.otherBank')} dir="auto" maxLength={60} value={institution} onChange={(e) => setInstitution(e.target.value)} data-testid="bank-other" />}
      </fieldset>
      <Field label={t('accounts.mask')} htmlFor="acc-mask">
        <Input id="acc-mask" inputMode="numeric" dir="ltr" maxLength={4} value={mask} onChange={(e) => setMask(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('accounts.opening')} htmlFor="acc-open">
          <AmountInput id="acc-open" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label={t('accounts.openingDate')} htmlFor="acc-open-date">
          <Input id="acc-open-date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
        </Field>
      </div>
      <Checkbox label={t('accounts.includeInForecast')} checked={forecast} onChange={setForecast} testId="account-forecast" />
      <Checkbox label={t('accounts.isLiquid')} checked={liquid} onChange={setLiquid} testId="account-liquid" />
      <div className="flex flex-wrap justify-between gap-2">
        {account ? (
          <Button variant="ghost" className="text-bad" busy={remove.isPending} onClick={() => remove.mutate(undefined)}>
            {t('common.delete')}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" busy={save.isPending} disabled={!name.trim() || openingMinor === null} data-testid="account-save">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function BalanceForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const { t } = useTranslation();
  const today = useMe()?.active?.today ?? '';
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const minor = parseMoneyInput(amount);
  const save = useApiMutation(() => post(`/api/accounts/${account.id}/balance`, { date, balanceMinor: minor }), { invalidate: [...LEDGER_DEPENDENT], onSuccess: onDone, successKey: 'ledger.saved' });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('accounts.balance')} htmlFor="bal-amt">
          <AmountInput id="bal-amt" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label={t('accounts.balanceDate')} htmlFor="bal-date">
          <Input id="bal-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Button disabled={minor === null || !date} busy={save.isPending} onClick={() => save.mutate(undefined)}>
        {t('common.save')}
      </Button>
    </div>
  );
}

export function Component() {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const q = useAccounts();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [balanceFor, setBalanceFor] = useState<Account | null>(null);
  const accounts = q.data?.accounts ?? [];
  const bankName = useBankName();
  const liquid = accounts.filter((a) => a.isLiquid && !a.archived).reduce((s, a) => s + Math.max(0, a.balanceMinor), 0);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('accounts.title')}
        actions={
          canWrite && (
            <Button onClick={() => setEditing('new')} data-testid="account-add" data-tour="account-add">
              <Plus className="size-5" aria-hidden />
              {t('accounts.add')}
            </Button>
          )
        }
      />
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : accounts.length === 0 ? (
        <EmptyState icon={<Landmark className="size-8" aria-hidden />} title={t('accounts.empty')} body={t('accounts.emptyBody')} />
      ) : (
        <>
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">{t('accounts.total')}</span>
              <Money minor={liquid} decimals={0} className="text-xl font-bold" />
            </div>
          </Card>
          <ul className="flex flex-col gap-3">
            {accounts.map((a) => (
              <li key={a.id}>
                <Card className={cx(a.archived && 'opacity-60')} data-testid="account-card">
                  <div className="flex items-start justify-between gap-3">
                    <BankBadge bankId={a.bankId} institution={a.institution} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">
                        <bdi>{a.name}</bdi> {a.accountMask && <span className="text-sm text-muted" dir="ltr">··{a.accountMask}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 text-xs">
                        <Badge>{t(`accounts.types.${a.type}`)}</Badge>
                        {bankName(a) && <Badge>{bankName(a)}</Badge>}
                        {a.includeInForecast && <Badge tone="accent">{t('nav.forecast')}</Badge>}
                        {a.archived && <Badge>{t('accounts.archived')}</Badge>}
                      </div>
                    </div>
                    <Money minor={a.balanceMinor} className="text-lg font-bold" />
                  </div>
                  {a.latestSnapshot && (
                    <p className="mt-2 text-xs text-muted">
                      {t('accounts.lastSnapshot')}: <Money minor={a.latestSnapshot.balanceMinor} /> · <DateText date={a.latestSnapshot.date} /> ({t(a.latestSnapshot.source === 'import' ? 'accounts.fromImport' : 'accounts.manualSnapshot')})
                    </p>
                  )}
                  {a.varianceMinor !== null && (
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className={cx(a.varianceMinor === 0 ? 'text-good' : 'text-warn')}>
                        {t('accounts.variance')}: <Money minor={a.varianceMinor} signed />
                      </span>
                      <ExplainSheet title={t('accounts.variance')} formula={t('accounts.varianceHelp')} rows={[{ label: t('accounts.lastSnapshot'), value: <Money minor={a.latestSnapshot?.balanceMinor ?? 0} /> }, { label: t('accounts.variance'), value: <Money minor={a.varianceMinor} signed /> }]} testId={`variance-${a.id}`} />
                    </div>
                  )}
                  <BankLink account={a} />
                  {canWrite && (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                        {t('common.edit')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setBalanceFor(a)}>
                        {t('accounts.setBalance')}
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? t('accounts.add') : t('common.edit')} testId="account-sheet">
        {editing && <AccountForm account={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={!!balanceFor} onOpenChange={(o) => !o && setBalanceFor(null)} title={t('accounts.setBalance')}>
        {balanceFor && <BalanceForm account={balanceFor} onDone={() => setBalanceFor(null)} />}
      </Sheet>
    </div>
  );
}
