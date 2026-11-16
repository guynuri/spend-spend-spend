import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { AlertTriangle, Info, Pencil, X } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get, patch } from '../../api';
import { Badge, Button, Card, CardTitle, ErrorState, IconButton, Spinner } from '../../components/ui';
import { AmountInput } from '../../components/AmountInput';
import { useApiMutation } from '../../lib/mutate';
import { useCanWrite } from '../../lib/session';
import { minorToInput, parseMoneyInput } from '../../../shared/money';
import { Money } from '../../components/Money';
import { DateText, useFormatDate } from '../../components/DateText';
import { ExplainSheet } from '../../components/ExplainSheet';
import { C, ChartBox, tooltipStyle, useCompactMoney, useMoneyFmt } from '../../components/charts';
import type { ForecastView } from '../../../shared/domain/forecast';

/** The safety cushion amount; owners and members can change it in place (household setting). */
function CushionValue({ minor }: { minor: number }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const [text, setText] = useState<string | null>(null);
  const v = text === null ? null : parseMoneyInput(text);
  const save = useApiMutation((m: number) => patch('/api/household', { safetyBufferMinor: m }), { invalidate: [['forecast'], ['dashboard'], ['household']], onSuccess: () => setText(null), successKey: 'ledger.saved' });
  if (text === null)
    return (
      <span className="flex items-center gap-2">
        <Money minor={minor} decimals={0} />
        {canWrite && (
          <Button variant="ghost" size="sm" onClick={() => setText(minorToInput(minor))} data-testid="cushion-edit">
            <Pencil className="size-4" aria-hidden />
            {t('forecast.cushionEdit')}
          </Button>
        )}
      </span>
    );
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (v !== null && v >= 0) save.mutate(v);
      }}
    >
      <AmountInput aria-label={t('forecast.cushionLabel')} className="max-w-36" value={text} onChange={(e) => setText(e.target.value)} autoFocus data-testid="cushion-input" />
      <Button type="submit" size="sm" busy={save.isPending} disabled={v === null || v < 0} data-testid="cushion-save">
        {t('forecast.cushionSave')}
      </Button>
      <IconButton label={t('common.cancel')} onClick={() => setText(null)}>
        <X className="size-4" aria-hidden />
      </IconButton>
    </form>
  );
}

export const useForecast = () => useQuery({ queryKey: ['forecast'], queryFn: () => get<ForecastView>('/api/forecast') });

export function ForecastExplain({ f }: { f: ForecastView }) {
  const { t } = useTranslation();
  const money = useMoneyFmt(2);
  const b = f.breakdown;
  return (
    <ExplainSheet
      title={t('forecast.explainTitle')}
      formula={t('forecast.explainFormula')}
      testId="explain-forecast"
      rows={[
        { label: <>{t('forecast.rows.start')} (<DateText date={f.asOf} />)</>, value: <Money minor={f.startBalance} />, testId: 'row-start' },
        { label: t('forecast.rows.income'), value: <Money minor={b.income} signed tone />, testId: 'row-income' },
        { label: t('forecast.rows.recurring'), value: <Money minor={b.recurring} signed tone />, testId: 'row-recurring' },
        { label: t('forecast.rows.card'), value: <Money minor={b.card} signed tone />, testId: 'row-card' },
        { label: t('forecast.rows.planned'), value: <Money minor={b.planned} signed tone />, testId: 'row-planned' },
        { label: t('forecast.rows.actuals'), value: <Money minor={b.actuals} signed tone />, testId: 'row-actuals' },
        { label: t('forecast.rows.variable'), value: <Money minor={b.variable} signed tone />, testId: 'row-variable' },
      ]}
      total={{ label: t('forecast.rows.eom'), value: <Money minor={f.eom?.balance ?? 0} />, testId: 'row-eom' }}
    >
      <p className="mt-3 text-xs text-muted">{f.lowConfidenceBaseline ? t('forecast.lowBaseline') : t('forecast.dailyEstimate', { amount: money(f.baselineDaily) })}</p>
    </ExplainSheet>
  );
}

export function ForecastChart({ f, height = 200 }: { f: ForecastView; height?: number }) {
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const data = f.series.map((s) => ({ ...s, label: fmt(s.date, 'dayMonth') }));
  const todayLabel = fmt(f.today, 'dayMonth');
  return (
    <ChartBox label={t('forecast.chart')} height={height}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="fc" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={C.accent} stopOpacity={0.3} />
              <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle(i18n.dir() === 'rtl')} />
          <ReferenceLine y={0} stroke={C.bad} strokeDasharray="3 3" />
          <ReferenceLine x={todayLabel} stroke={C.text} label={{ value: t('forecast.today'), fill: C.text, position: 'insideTopLeft', fontSize: 11 }} />
          <Area type="stepAfter" dataKey="balance" name={t('accounts.balance')} stroke={C.accent} fill="url(#fc)" strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartBox>
  );
}

export function ForecastCard({ withChart = true, link = true }: { withChart?: boolean; link?: boolean }) {
  const { t } = useTranslation();
  const q = useForecast();
  if (q.isPending)
    return (
      <Card>
        <Spinner />
      </Card>
    );
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const f = q.data;
  if (!f.hasForecastAccount)
    return (
      <Card data-testid="forecast-card">
        <CardTitle>{t('forecast.title')}</CardTitle>
        <p className="text-sm text-muted">{t('forecast.noAccount')}</p>
      </Card>
    );
  const tone = f.confidence === 'high' ? 'good' : f.confidence === 'medium' ? 'warn' : 'bad';
  return (
    <Card data-testid="forecast-card">
      <CardTitle action={<Badge tone={tone}>{t(`forecast.confidence.${f.confidence}`)}</Badge>}>{link ? <Link to="/forecast">{t('forecast.eom')}</Link> : t('forecast.eom')}</CardTitle>
      <div data-tour="forecast-eom">
        <Money minor={f.eom?.balance ?? 0} decimals={0} className="text-3xl font-bold" />
        <span className="sr-only" data-testid="forecast-eom" data-minor={f.eom?.balance ?? 0} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        {f.low && (
          <div data-testid="forecast-low">
            <dt className="text-xs text-muted">{t('forecast.low')}</dt>
            <dd className={f.low.balance < 0 ? 'font-semibold text-bad' : 'font-semibold'}>
              <Money minor={f.low.balance} decimals={0} /> · <DateText date={f.low.date} format="dayMonth" />
            </dd>
          </div>
        )}
        {f.afterNextCard && (
          <div>
            <dt className="text-xs text-muted">{t('forecast.afterCard')}</dt>
            <dd className="font-semibold">
              <Money minor={f.afterNextCard.balance} decimals={0} /> · <DateText date={f.afterNextCard.date} format="dayMonth" />
            </dd>
          </div>
        )}
        <div className="col-span-2" data-testid="forecast-cushion" data-tour="forecast-cushion">
          <dt className="text-xs text-muted">
            <details>
              <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1" data-testid="cushion-term">
                {t('forecast.cushion')}
                <Info className="size-3.5" aria-label={t('forecast.cushionWhat')} />
              </summary>
              <span className="mt-1 block rounded-lg bg-surface-2 p-2 text-text" data-testid="cushion-hint">
                {t('forecast.cushionHint')}
              </span>
            </details>
          </dt>
          <dd className="font-semibold">
            <CushionValue minor={f.safetyBuffer} />
          </dd>
        </div>
      </dl>
      {(f.belowZero || f.belowBuffer) && (
        <p className="mt-3 flex gap-2 rounded-xl bg-bad/10 p-2 text-sm text-bad" role="status">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {t(f.belowZero ? 'forecast.belowZero' : 'forecast.belowBuffer')}
        </p>
      )}
      {f.stale && <p className="mt-2 text-sm text-warn">{t('forecast.stale')}</p>}
      {withChart && (
        <div className="mt-3">
          <ForecastChart f={f} />
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{t('forecast.asOf')}<DateText date={f.asOf} /></span>
        <ForecastExplain f={f} />
      </div>
    </Card>
  );
}
