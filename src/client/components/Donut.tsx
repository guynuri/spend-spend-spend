import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Money } from './Money';
import { cx } from './ui';
import { OTHER_SLOT, slotVar } from '../../shared/categoryLook';
import { donutSlices, type DonutInput } from '../../shared/donut';
import { formatPercent, type Locale } from '../../shared/money';

const SIZE = 208;
const STROKE = 20;
/** Room for the selected slice to grow without clipping. */
const PAD = 5;
const R = (SIZE - STROKE) / 2 - PAD;
const CIRC = 2 * Math.PI * R;
/** Visible gap between two rounded segment ends, in px along the ring. */
const GAP = 6;

/**
 * Spending split into a ring: up to five categories in their own colours plus "Other", the total (or the
 * tapped slice) in the middle, and a legend with names and amounts beside it so no slice is read by colour
 * alone. Tapping a slice or a legend row selects it; `onOpen` lets the row open the category.
 */
export function Donut({ items, label, centerLabel, onOpen, max = 5, testId }: { items: DonutInput[]; label: string; centerLabel: ReactNode; onOpen?: (id: string) => void; max?: number; testId?: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const slices = donutSlices(items, max, t('charts.other'));
  const total = slices.reduce((a, s) => a + s.valueMinor, 0);
  const [active, setActive] = useState<string | null>(null);
  const sel = slices.find((s) => s.id === active) ?? null;
  // Rounded, pill-shaped segments: each round cap reaches STROKE / 2 past the dash, so the dash is
  // shortened by a full STROKE plus the gap and shifted by half of that. A slice too small for its caps
  // becomes a dot (a near-zero dash with round caps).
  const many = slices.length > 1;
  let offset = 0;
  const arcs = slices.map((s) => {
    const len = total > 0 ? (s.valueMinor / total) * CIRC : 0;
    const trim = many ? STROKE + GAP : 0;
    const arc = { s, start: offset + (many ? trim / 2 : 0), len: Math.max(0.01, len - trim) };
    offset += len;
    return arc;
  });
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6" data-testid={testId}>
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label={label} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--mz-surface-2)" strokeWidth={STROKE} />
          {arcs.map(({ s, start, len }) => (
            <circle
              key={s.id}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={slotVar(s.slot)}
              strokeWidth={active === s.id ? STROKE + 8 : STROKE}
              strokeLinecap={many ? 'round' : 'butt'}
              strokeDasharray={`${len} ${CIRC - len}`}
              strokeDashoffset={-start}
              opacity={active && active !== s.id ? 0.35 : 1}
              className="cursor-pointer transition-[opacity,stroke-width] duration-200"
              onClick={() => setActive((a) => (a === s.id ? null : s.id))}
              onMouseEnter={() => setActive(s.id)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${s.label}: ${formatPercent(total > 0 ? s.valueMinor / total : 0, locale)}`}</title>
            </circle>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center" aria-live="polite">
          {sel ? (
            <>
              <span className="max-w-full truncate text-sm text-muted">
                {sel.emoji ? `${sel.emoji} ` : ''}
                {sel.label}
              </span>
              <span className="text-xl font-bold tracking-tight">
                <Money minor={sel.valueMinor} decimals={0} />
              </span>
              <span className="text-xs text-muted">{formatPercent(total > 0 ? sel.valueMinor / total : 0, locale)}</span>
            </>
          ) : (
            <>
              <span className="text-sm text-muted">{centerLabel}</span>
              <span className="text-2xl font-bold tracking-tight">
                <Money minor={total} decimals={0} />
              </span>
            </>
          )}
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-1">
        {slices.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={cx('flex min-h-11 w-full items-center gap-3 rounded-2xl px-2 text-start transition', active === s.id ? 'bg-surface-2' : 'hover:bg-surface-2')}
              onClick={() => (onOpen && s.id !== OTHER_SLOT ? onOpen(s.id) : setActive((a) => (a === s.id ? null : s.id)))}
              onMouseEnter={() => setActive(s.id)}
              onMouseLeave={() => setActive(null)}
              data-testid="donut-row"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-base" style={{ background: `color-mix(in srgb, ${slotVar(s.slot)} 18%, transparent)` }} aria-hidden>
                {s.emoji ?? <span className="size-3 rounded-full" style={{ background: slotVar(s.slot) }} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
              <span className="text-xs text-muted tabular">{formatPercent(total > 0 ? s.valueMinor / total : 0, locale)}</span>
              <span className="w-20 text-end text-sm font-semibold tabular">
                <Money minor={s.valueMinor} decimals={0} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
