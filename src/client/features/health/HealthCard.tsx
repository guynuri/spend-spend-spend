import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Info, TrendingDown, TrendingUp } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { get } from '../../api';
import { Badge, Card, CardTitle, cx, ProgressBar, type Tone } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { useFormatDate } from '../../components/DateText';
import { C, ChartBox } from '../../components/charts';
import { useParamFormatter } from '../../lib/format';
import { formatPercent, type Locale } from '../../../shared/money';
import { SUB_KEYS, WEIGHTS, type Label, type Recommendation, type SubKey } from '../../../shared/domain/health';

export interface HealthData {
  overall: number | null;
  label: Label | null;
  change: number | null;
  subs: Record<SubKey, { score: number | null; input: number | null; label: Label | null }>;
  trend: { month: string; overall: number | null }[];
  recommendations?: Recommendation[];
}
const TONE: Record<Label, Tone> = { excellent: 'good', good: 'good', fair: 'warn', needs_attention: 'bad' };

function inputText(k: SubKey, v: number | null, loc: Locale) {
  if (v === null) return '—';
  if (k === 'cushion') return v.toFixed(1);
  return formatPercent(v, loc);
}

export function HealthSheet({ data, open, onOpenChange }: { data: HealthData; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const pf = useParamFormatter();
  const q = useQuery({ queryKey: ['health'], queryFn: () => get<HealthData>('/api/health-score?months=6'), enabled: open });
  const recs = q.data?.recommendations ?? data.recommendations ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('health.title')} testId="health-sheet">
      <p className="mb-3 rounded-xl bg-surface-2 p-3 text-sm">{t('health.formula')}</p>
      <ul className="flex flex-col gap-3">
        {SUB_KEYS.map((k) => {
          const s = data.subs[k];
          return (
            <li key={k} data-testid={`sub-${k}`}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {t(`health.subs.${k}`)} <span className="text-xs text-muted">({t('health.weight', { weight: WEIGHTS[k] })})</span>
                </span>
                <span className="tabular">{s.score === null ? t('common.notEnoughData') : Math.round(s.score)}</span>
              </div>
              {s.score !== null && <ProgressBar value={s.score / 100} tone={TONE[s.label!]} label={t(`health.subs.${k}`)} />}
              <p className="text-xs text-muted">
                {t(`health.inputs.${k}`)}: <bdi className="tabular">{inputText(k, s.input, i18n.language as Locale)}</bdi>
              </p>
              <p className="text-xs text-muted" dir="ltr">
                {t(`health.curves.${k}`)}
              </p>
            </li>
          );
        })}
      </ul>
      {data.trend.some((p) => p.overall !== null) && (
        <>
          <h3 className="mb-1 mt-4 text-sm font-semibold">{t('health.trend')}</h3>
          <ChartBox label={t('health.trend')} height={140}>
            <ResponsiveContainer>
              <LineChart data={data.trend.map((p) => ({ ...p, label: fmt(p.month, 'monthShort') }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: C.text }} width={28} axisLine={false} tickLine={false} />
                <Line dataKey="overall" stroke={C.accent} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
        </>
      )}
      {recs.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 text-sm font-semibold">{t('health.recommendations')}</h3>
          <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm" data-testid="health-recs">
            {recs.map((r) => (
              <li key={r.key}>
                {t(`health.recs.${r.key}`, pf({ amountMinor: r.amountMinor }))} <Badge tone="good">{t('health.gain', { points: r.gain.toFixed(1) })}</Badge>
              </li>
            ))}
          </ol>
        </>
      )}
    </Sheet>
  );
}

export function HealthCard({ data }: { data: HealthData }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const up = (data.change ?? 0) >= 0;
  return (
    <Card data-testid="health-card">
      <CardTitle
        action={
          <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-1 text-sm text-accent" data-testid="health-open">
            <Info className="size-4" aria-hidden />
            {t('explain.open')}
          </button>
        }
      >
        {t('health.title')}
      </CardTitle>
      {data.overall === null ? (
        <div>
          <p className="font-medium">{t('health.noScore')}</p>
          <p className="text-sm text-muted">{t('health.noScoreBody')}</p>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="text-4xl font-bold tabular" data-testid="health-score">
            {data.overall}
          </div>
          <div>
            <Badge tone={TONE[data.label!]}>{t(`health.labels.${data.label}`)}</Badge>
            {data.change !== null && (
              <p className={cx('mt-1 flex items-center gap-1 text-xs', up ? 'text-good' : 'text-bad')}>
                {up ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />}
                {t('health.change', { change: `${up ? '+' : ''}${data.change}` })}
              </p>
            )}
          </div>
        </div>
      )}
      <ul className="mt-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
        {SUB_KEYS.map((k) => (
          <li key={k} className="flex justify-between gap-2">
            <span className="text-muted">{t(`health.subs.${k}`)}</span>
            <span className="tabular">{data.subs[k].score === null ? '—' : Math.round(data.subs[k].score!)}</span>
          </li>
        ))}
      </ul>
      <HealthSheet data={data} open={open} onOpenChange={setOpen} />
    </Card>
  );
}
