import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, ProgressBar } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { useParamFormatter } from '../../lib/format';
import { formatPercent, type Locale, type MoneyTone } from '../../../shared/money';
import type { CatAmount, Chapter, Commentary, ReviewSnapshot } from '../../../shared/domain/review';
import { InsightList } from '../overview/Insights';

export function CommentaryText({ c, ai }: { c: Commentary; ai?: string | null }) {
  const { t } = useTranslation();
  const pf = useParamFormatter();
  const params = { ...c.params };
  if (typeof params.netMinor === 'number') params.netMinor = Math.abs(params.netMinor);
  return (
    <p className="rounded-xl bg-surface-2 p-3 text-sm" data-testid="chapter-commentary">
      {ai ? <span data-testid="ai-text">{ai}</span> : t(c.key, pf(params))}
    </p>
  );
}

function Stat({ label, value, prev, tone }: { label: ReactNode; value: number; prev?: number; tone?: MoneyTone }) {
  const { t, i18n } = useTranslation();
  const ch = prev ? (value - prev) / Math.abs(prev) : null;
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <Money minor={value} decimals={0} className="text-xl font-bold" tone={tone} />
      {ch !== null && (
        <div className="text-xs text-muted">
          <bdi>{`${ch >= 0 ? '+' : ''}${formatPercent(ch, i18n.language as Locale)}`}</bdi> {t('review.vsPrev')}
        </div>
      )}
    </div>
  );
}

function Cats({ items }: { items: CatAmount[] }) {
  const { t, i18n } = useTranslation();
  if (!items.length) return <p className="text-sm text-muted">{t('review.noItems')}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.slice(0, 10).map((c, i) => (
        <li key={i}>
          <div className="flex justify-between text-sm">
            <bdi>{c.name ?? t('ledger.uncategorized')}</bdi>
            <span className="text-muted">
              <Money minor={c.amountMinor} decimals={0} /> · {formatPercent(c.share, i18n.language as Locale)}
            </span>
          </div>
          <ProgressBar value={c.share} label={c.name ?? ''} />
        </li>
      ))}
    </ul>
  );
}

export function ChapterView({ ch, s, ai }: { ch: Chapter; s: ReviewSnapshot; ai: Record<string, string> | null }) {
  const { t, i18n } = useTranslation();
  const loc = i18n.language as Locale;
  const a = ai?.[ch] ?? null;
  switch (ch) {
    case 'summary':
      return (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-4xl font-bold tabular">{s.summary.score ?? '—'}</span>
            {s.summary.label && <Badge tone="accent">{t(`health.labels.${s.summary.label}`)}</Badge>}
            {s.summary.change !== null && <span className="text-sm text-muted">{t('health.change', { change: `${s.summary.change >= 0 ? '+' : ''}${s.summary.change}` })}</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t('dashboard.income')} value={s.summary.incomeMinor} tone="in" />
            <Stat label={t('dashboard.expenses')} value={s.summary.expensesMinor} tone="out" />
            <Stat label={t('dashboard.net')} value={s.summary.netMinor} tone />
          </div>
          {s.summary.chips.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="review-chips">
              {s.summary.chips.map((c) => (
                <Badge key={c} tone="good">
                  {t(`review.chips.${c}`)}
                </Badge>
              ))}
            </div>
          )}
          <CommentaryText c={s.summary.commentary} ai={a} />
          <InsightList items={s.summary.headlines} />
        </div>
      );
    case 'income':
      return (
        <div className="flex flex-col gap-4">
          <Stat label={t('dashboard.income')} value={s.income.totalMinor} prev={s.income.prevMinor} tone="in" />
          <CommentaryText c={s.income.commentary} ai={a} />
          <Cats items={s.income.byCategory} />
        </div>
      );
    case 'spending':
      return (
        <div className="flex flex-col gap-4">
          <Stat label={t('dashboard.expenses')} value={s.spending.totalMinor} prev={s.spending.prevMinor} tone="out" />
          <CommentaryText c={s.spending.commentary} ai={a} />
          <Cats items={s.spending.byCategory} />
          {s.spending.notable.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">{t('review.notable')}</h3>
              <ul className="divide-y divide-border text-sm">
                {s.spending.notable.map((n, i) => (
                  <li key={i} className="flex justify-between gap-2 py-2">
                    <span className="min-w-0 truncate">
                      <DateText date={n.date} format="dayMonth" className="text-muted" /> · <bdi>{n.description}</bdi>
                    </span>
                    <Money minor={n.amountMinor} decimals={0} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    case 'budget':
      return (
        <div className="flex flex-col gap-4">
          {s.budget.total > 0 && <p className="font-medium">{t('review.adherence', { ok: s.budget.ok, total: s.budget.total })}</p>}
          <CommentaryText c={s.budget.commentary} ai={a} />
          <ul className="flex flex-col gap-2">
            {s.budget.lines.map((l, i) => (
              <li key={i}>
                <div className="flex justify-between text-sm">
                  <bdi>{l.name}</bdi>
                  <span className={l.overMinor > 0 ? 'text-bad' : 'text-muted'}>
                    <Money minor={l.spentMinor} decimals={0} /> / <Money minor={l.limitMinor} decimals={0} />
                  </span>
                </div>
                <ProgressBar value={l.limitMinor ? l.spentMinor / l.limitMinor : 1} tone={l.overMinor > 0 ? 'bad' : 'good'} label={l.name} />
              </li>
            ))}
          </ul>
        </div>
      );
    case 'goals':
      return (
        <div className="flex flex-col gap-4">
          {s.goals.targetMinor > 0 && (
            <p className="font-medium">
              <Money minor={s.goals.savedMinor} decimals={0} /> / <Money minor={s.goals.targetMinor} decimals={0} />
            </p>
          )}
          <CommentaryText c={s.goals.commentary} ai={a} />
          <ul className="flex flex-col gap-3">
            {s.goals.items.map((g, i) => (
              <li key={i}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <bdi>{g.name}</bdi>
                  <Badge tone={g.status === 'behind' ? 'warn' : 'good'}>{t(`goals.status.${g.status}`)}</Badge>
                </div>
                <ProgressBar value={g.progress} label={g.name} />
                <div className="text-xs text-muted">
                  {g.requiredMonthlyMinor !== null && (
                    <>
                      {t('goals.required')}: <Money minor={g.requiredMonthlyMinor} decimals={0} />
                    </>
                  )}
                  {g.milestones.map((m) => (
                    <Badge key={m} tone="good" className="ms-1">{`${m}%`}</Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'cashflow':
      return (
        <div className="flex flex-col gap-4">
          {s.cashflow.savingsRate !== null && (
            <div>
              <div className="text-xs text-muted">{t('review.savingsRate')}</div>
              <div className="text-xl font-bold">
                <bdi>{formatPercent(s.cashflow.savingsRate, loc)}</bdi>
              </div>
            </div>
          )}
          <CommentaryText c={s.cashflow.commentary} ai={a} />
          {s.cashflow.forecast && (
            <div className="rounded-xl border border-border p-3 text-sm">
              <div className="font-medium">{t('review.forecastNow')}</div>
              <div>
                {t('forecast.eom')}: <Money minor={s.cashflow.forecast.eomMinor} decimals={0} />
              </div>
              <div>
                {t('forecast.low')}: <Money minor={s.cashflow.forecast.lowMinor} decimals={0} /> · <DateText date={s.cashflow.forecast.lowDate} format="dayMonth" />
              </div>
            </div>
          )}
          <ul className="divide-y divide-border text-sm">
            {s.cashflow.upcoming.map((u, i) => (
              <li key={i} className="flex justify-between gap-2 py-2">
                <span>
                  <DateText date={u.date} format="dayMonth" className="text-muted" /> · <bdi>{u.label}</bdi>
                </span>
                <Money minor={u.amountMinor} decimals={0} tone />
              </li>
            ))}
          </ul>
        </div>
      );
    case 'wrapup':
      return <Wrapup s={s} ai={ai} />;
  }
}

function Wrapup({ s, ai }: { s: ReviewSnapshot; ai: Record<string, string> | null }) {
  const { t } = useTranslation();
  const pf = useParamFormatter();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg font-semibold" data-testid="review-headline">
        {ai?.headline ? <span data-testid="ai-headline">{ai.headline}</span> : t(s.wrapup.headline.key, pf(s.wrapup.headline.params))}
      </p>
      <CommentaryText c={s.wrapup.commentary} ai={ai?.wrapup ?? null} />
      <div>
        <h3 className="mb-1 text-sm font-semibold text-good">{t('review.wins')}</h3>
        <InsightList items={s.wrapup.wins} />
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold text-warn">{t('review.watch')}</h3>
        <InsightList items={s.wrapup.watch} />
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold">{t('review.nextSteps')}</h3>
        {s.wrapup.nextSteps.length === 0 ? (
          <p className="text-sm text-muted">{t('review.noItems')}</p>
        ) : (
          <ol className="list-decimal ps-5 text-sm">
            {s.wrapup.nextSteps.map((r) => (
              <li key={r.key} className="py-1">
                {t(`health.recs.${r.key}`, pf({ amountMinor: r.amountMinor }))} <Badge tone="good">{t('health.gain', { points: r.gain.toFixed(1) })}</Badge>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
