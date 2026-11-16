import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Flag, Plus, Target } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, ProgressBar, Spinner, type Tone } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { AmountInput } from '../../components/AmountInput';
import { ExplainSheet } from '../../components/ExplainSheet';
import { useApiMutation } from '../../lib/mutate';
import { useParamFormatter } from '../../lib/format';
import { useCanWrite, useMe } from '../../lib/session';
import { minorToInput, parseMoneyInput } from '../../../shared/money';
import type { GoalStatus, GoalView, GoalsSummary } from '../../../shared/domain/goals';

const KEYS = [['goals'], ['dashboard'], ['health']];
const TONE: Record<GoalStatus, Tone> = { completed: 'good', on_track: 'good', behind: 'warn', no_deadline: 'neutral' };
interface Contribution {
  id: string;
  goalId: string;
  date: string;
  amountMinor: number;
  note: string | null;
}

function GoalForm({ goal, onDone }: { goal: GoalView | null; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? minorToInput(goal.targetMinor) : '');
  const [date, setDate] = useState(goal?.targetDate ?? '');
  const [start, setStart] = useState('');
  const tm = parseMoneyInput(target);
  const sm = start.trim() ? parseMoneyInput(start) : 0;
  const body = { name: name.trim(), targetMinor: tm, targetDate: date || null, ...(goal ? {} : { startMinor: sm ?? 0 }) };
  const save = useApiMutation(() => (goal ? patch(`/api/goals/${goal.id}`, body) : post('/api/goals', body)), { invalidate: KEYS, onSuccess: onDone, successKey: 'ledger.saved' });
  const remove = useApiMutation(() => del(`/api/goals/${goal!.id}`), { invalidate: KEYS, onSuccess: onDone });
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('goals.name')} htmlFor="g-name">
        <Input id="g-name" dir="auto" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} data-testid="goal-name" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('goals.target')} htmlFor="g-target">
          <AmountInput id="g-target" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="goal-target" placeholder="0" />
        </Field>
        <Field label={t('goals.targetDate')} htmlFor="g-date">
          <Input id="g-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="goal-date" />
        </Field>
      </div>
      {!goal && (
        <Field label={t('goals.start')} htmlFor="g-start">
          <AmountInput id="g-start" value={start} onChange={(e) => setStart(e.target.value)} placeholder="0" />
        </Field>
      )}
      <div className="flex justify-between gap-2">
        {goal ? (
          <Button variant="ghost" className="text-bad" onClick={() => window.confirm(t('goals.deleteConfirm')) && remove.mutate(undefined)}>
            {t('common.delete')}
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={!name.trim() || !tm || tm <= 0 || sm === null} busy={save.isPending} onClick={() => save.mutate(undefined)} data-testid="goal-save">
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

function ContributeForm({ goal, onDone }: { goal: GoalView; onDone: () => void }) {
  const { t } = useTranslation();
  const today = useMe()?.active?.today ?? '';
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const m = parseMoneyInput(amount);
  const save = useApiMutation(() => post(`/api/goals/${goal.id}/contributions`, { date, amountMinor: m, ...(note.trim() ? { note: note.trim() } : {}) }), { invalidate: KEYS, onSuccess: onDone, successKey: 'ledger.saved' });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('goals.contribution')} htmlFor="c-amt">
          <AmountInput id="c-amt" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="contribution-amount" placeholder="0" />
        </Field>
        <Field label={t('ledger.date')} htmlFor="c-date">
          <Input id="c-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label={t('goals.note')} htmlFor="c-note">
        <Input id="c-note" dir="auto" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Button disabled={!m} busy={save.isPending} onClick={() => save.mutate(undefined)} data-testid="contribution-save">
        {t('common.save')}
      </Button>
    </div>
  );
}

export function GoalCard({ g, onEdit, onContribute }: { g: GoalView; onEdit?: () => void; onContribute?: () => void }) {
  const { t } = useTranslation();
  const pf = useParamFormatter();
  return (
    <Card data-testid="goal-card" data-tour="goal-card" data-status={g.status}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" disabled={!onEdit} onClick={onEdit} className="min-h-11 min-w-0 text-start">
          <div className="truncate font-semibold">
            <bdi>{g.name}</bdi>
          </div>
          <div className="text-xs text-muted">
            <Money minor={g.savedMinor} decimals={0} /> / <Money minor={g.targetMinor} decimals={0} />
            {g.targetDate && (
              <>
                {' '}
                · <DateText date={g.targetDate} />
              </>
            )}
          </div>
        </button>
        <Badge tone={TONE[g.status]}>{t(`goals.status.${g.status}`)}</Badge>
      </div>
      <div className="relative mt-2">
        <ProgressBar value={g.progress} tone={g.status === 'behind' ? 'warn' : 'accent'} label={g.name} />
        <div className="pointer-events-none absolute inset-0">
          {[25, 50, 75].map((p) => (
            <span key={p} className="absolute top-0 h-2 w-px bg-surface" style={{ insetInlineStart: `${p}%` }} />
          ))}
        </div>
      </div>
      {g.milestones.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="goal-milestones">
          {g.milestones.map((m) => (
            <Badge key={m.pct} tone="good">
              <Flag className="size-3" aria-hidden />
              {`${m.pct}%`}
            </Badge>
          ))}
        </div>
      )}
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted">{t('goals.remaining')}</dt>
          <dd>
            <Money minor={g.remainingMinor} decimals={0} />
          </dd>
        </div>
        {g.requiredMonthlyMinor !== null && g.status !== 'completed' && (
          <div>
            <dt className="text-muted">{t('goals.required')}</dt>
            <dd>
              <Money minor={g.requiredMonthlyMinor} decimals={0} />
            </dd>
          </div>
        )}
      </dl>
      {g.paceMinor > 0 && g.status !== 'completed' && (
        <p className="mt-1 text-xs text-muted">
          {t('goals.pace', pf({ amountMinor: g.paceMinor }))}
          {g.projectedFinish && <> · {t('goals.projected', pf({ date: g.projectedFinish }))}</>}
        </p>
      )}
      {onContribute && g.status !== 'completed' && (
        <Button size="sm" variant="secondary" className="mt-2" onClick={onContribute} data-testid="goal-contribute">
          <Plus className="size-4" aria-hidden />
          {t('goals.contribute')}
        </Button>
      )}
    </Card>
  );
}

export function Component() {
  const { t } = useTranslation();
  const pf = useParamFormatter();
  const canWrite = useCanWrite();
  const q = useQuery({ queryKey: ['goals'], queryFn: () => get<{ goals: GoalView[]; summary: GoalsSummary; contributions: Contribution[] }>('/api/goals') });
  const [editing, setEditing] = useState<GoalView | 'new' | null>(null);
  const [contrib, setContrib] = useState<GoalView | null>(null);
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { goals, summary } = q.data;
  const visible = goals.filter((g) => !g.archived);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('goals.title')}
        actions={
          canWrite && (
            <Button onClick={() => setEditing('new')} data-testid="goal-add">
              <Plus className="size-5" aria-hidden />
              {t('goals.add')}
            </Button>
          )
        }
      />
      {visible.length === 0 ? (
        <EmptyState icon={<Target className="size-8" aria-hidden />} title={t('goals.empty')} />
      ) : (
        <>
          <Card data-testid="goals-summary">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Money minor={summary.totalSavedMinor} decimals={0} className="text-xl font-bold" /> / <Money minor={summary.totalTargetMinor} decimals={0} className="text-muted" />
                <p className="text-xs text-muted">{t('goals.summary', { active: summary.activeCount, behind: summary.behindCount })}</p>
              </div>
              <ExplainSheet title={t('goals.title')} formula={t('goals.explain')} rows={[{ label: t('goals.allocation'), value: <Money minor={summary.committedMonthlyMinor} /> }]} testId="explain-goals" />
            </div>
            <p className="mt-2 text-sm">
              {t('goals.allocation')}: {summary.noSurplus ? t('goals.noSurplus') : t('goals.allocationLine', pf({ committedMinor: summary.committedMonthlyMinor, surplusMinor: summary.surplusMinor }))}
            </p>
          </Card>
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map((g) => (
              <GoalCard key={g.id} g={g} onEdit={canWrite ? () => setEditing(g) : undefined} onContribute={canWrite ? () => setContrib(g) : undefined} />
            ))}
          </div>
        </>
      )}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? t('goals.add') : t('common.edit')} testId="goal-sheet">
        {editing && <GoalForm goal={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={!!contrib} onOpenChange={(o) => !o && setContrib(null)} title={t('goals.contribute')} description={contrib?.name} testId="contribution-sheet">
        {contrib && <ContributeForm goal={contrib} onDone={() => setContrib(null)} />}
      </Sheet>
    </div>
  );
}
