import { useState, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Money } from './Money';
import { cx } from './ui';
import { OTHER_SLOT, slotVar } from '../../shared/categoryLook';
import { arcLengths, donutSlices, shades, type DonutInput, type DonutSlice } from '../../shared/donut';
import { formatPercent, type Locale } from '../../shared/money';
import { GENERAL_ID } from '../../shared/domain/budget';

const SIZE = 208;
const STROKE = 20;
/** Room for the selected slice to grow without clipping. */
const PAD = 5;
const R = (SIZE - STROKE) / 2 - PAD;
const CIRC = 2 * Math.PI * R;
/** Visible gap between two rounded segment ends, in px along the ring. */
const GAP = 6;
/** Shortest visible pill (on top of its round caps), so a 1 % slice never collapses onto a neighbour. */
const MIN_DASH = 6;

const colorOf = (s: DonutSlice) => s.color ?? slotVar(s.slot);
/** Only a real mouse previews on hover; on a phone a tap is a tap (no "enter" that the tap then undoes). */
const mouse = (e: PointerEvent) => e.pointerType === 'mouse';

/**
 * Spending split into a ring: up to five slices in their own colours plus "Other", the total (or the
 * selected slice) in the middle, and a legend with names and amounts so no slice is read by colour alone.
 * A tap selects a slice (another tap on it opens it). A slice with `children` opens, in place, a ring of
 * its parts — a category's subcategories in shades of its colour, "Other" into what was folded into it —
 * with a way back and, for a category, a link to its transactions; a slice without opens through
 * `onOpen` (e.g. its transactions).
 */
export function Donut({ items, label, centerLabel, onOpen, max = 5, testId, tourId }: { items: DonutInput[]; label: string; centerLabel: ReactNode; onOpen?: (id: string) => void; max?: number; testId?: string; /** `data-tour` on the ring. */ tourId?: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  /** The opened slices, outermost first. */
  const [path, setPath] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Walk the path: each opened slice's parts, shaded with the category colour they belong to (if any).
  const levels: { slices: DonutSlice[]; parent: DonutSlice | null; base: string | null }[] = [{ slices: donutSlices(items, max, t('charts.other')), parent: null, base: null }];
  for (const id of path) {
    const cur = levels[levels.length - 1]!;
    const p = cur.slices.find((s) => s.id === id && s.children?.length);
    if (!p) break; // the data changed under an opened slice: stay where it still exists
    const base = p.id === OTHER_SLOT ? cur.base : colorOf(p);
    const kids = donutSlices(p.children!, max, t('charts.other'));
    const tones = base ? shades(base, kids.length) : null;
    levels.push({ slices: tones ? kids.map((k, i) => ({ ...k, color: tones[i] })) : kids, parent: p, base });
  }
  const { slices, parent } = levels[levels.length - 1]!;
  const up = levels.length > 1 ? levels[levels.length - 2]!.parent : null;
  const go = (next: string[]) => {
    setPath(next);
    setActive(null);
    setHover(null);
  };
  /** A real category (not "Other", not the general expenses, not a parent's own lines) opens its transactions. */
  const opens = (id: string) => !!onOpen && id !== OTHER_SLOT && id !== GENERAL_ID && !id.includes(':');
  const total = slices.reduce((a, s) => a + s.valueMinor, 0);
  const shown = hover ?? active;
  const sel = slices.find((s) => s.id === shown) ?? null;
  const many = slices.length > 1;
  const lengths = arcLengths(
    slices.map((s) => s.valueMinor),
    CIRC,
    many ? STROKE + GAP + MIN_DASH : 0,
  );
  let offset = 0;
  const arcs = slices.map((s, k) => {
    const len = lengths[k]!;
    // each round cap reaches STROKE / 2 past the dash: shorten by a full STROKE plus the gap, shift by half
    const trim = many ? STROKE + GAP : 0;
    const arc = { s, start: offset + trim / 2, len: Math.max(0.01, len - trim) };
    offset += len;
    return arc;
  });
  const open = (s: DonutSlice) => {
    if (s.children?.length) go([...path.slice(0, levels.length - 1), s.id]);
    else if (opens(s.id) || (onOpen && s.id === GENERAL_ID)) onOpen!(s.id);
  };
  // first tap selects; a second tap on the selected slice opens it
  const tapSlice = (s: DonutSlice) => (active === s.id ? open(s) : setActive(s.id));
  const pct = (m: number) => formatPercent(total > 0 ? m / total : 0, locale);
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {parent && (
        <div className="flex flex-wrap items-center justify-between gap-1">
          <button type="button" onClick={() => go(path.slice(0, levels.length - 2))} className="inline-flex min-h-11 items-center gap-1 rounded-2xl px-2 text-sm font-medium text-accent hover:bg-surface-2" data-testid="donut-back">
            <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            {up ? t('charts.backTo', { name: up.label }) : t('charts.allCategories')}
          </button>
          {opens(parent.id) && (
            <button type="button" onClick={() => onOpen!(parent.id)} className="inline-flex min-h-11 items-center gap-1 rounded-2xl px-2 text-sm font-medium text-accent hover:bg-surface-2" data-testid="donut-open-list">
              {t('charts.seeTransactions')}
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }} data-tour={tourId}>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label={parent ? `${label}: ${parent.label}` : label} className="-rotate-90 touch-manipulation">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--mz-surface-2)" strokeWidth={STROKE} />
            {arcs.map(({ s, start, len }) => (
              <circle
                key={s.id}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={colorOf(s)}
                strokeWidth={shown === s.id ? STROKE + 8 : STROKE}
                strokeLinecap={many ? 'round' : 'butt'}
                strokeDasharray={`${len} ${CIRC - len}`}
                strokeDashoffset={-start}
                opacity={shown && shown !== s.id ? 0.35 : 1}
                className="cursor-pointer transition-[opacity,stroke-width] duration-150"
                onClick={() => tapSlice(s)}
                onPointerEnter={(e) => mouse(e) && setHover(s.id)}
                onPointerLeave={(e) => mouse(e) && setHover(null)}
                data-testid="donut-slice"
              >
                <title>{`${s.label}: ${pct(s.valueMinor)}`}</title>
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
                <span className="text-xs text-muted">{pct(sel.valueMinor)}</span>
              </>
            ) : (
              <>
                <span className="max-w-full truncate text-sm text-muted">{parent ? `${parent.emoji ? `${parent.emoji} ` : ''}${parent.label}` : centerLabel}</span>
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
                className={cx('flex min-h-11 w-full items-center gap-3 rounded-2xl px-2 text-start transition', shown === s.id ? 'bg-surface-2' : 'hover:bg-surface-2')}
                onClick={() => open(s)}
                onPointerEnter={(e) => mouse(e) && setHover(s.id)}
                onPointerLeave={(e) => mouse(e) && setHover(null)}
                data-testid="donut-row"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-base" style={{ background: `color-mix(in srgb, ${colorOf(s)} 22%, transparent)` }} aria-hidden>
                  {s.emoji ?? <span className="size-3 rounded-full" style={{ background: colorOf(s) }} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
                <span className="text-xs text-muted tabular">{pct(s.valueMinor)}</span>
                <span className="w-20 text-end text-sm font-semibold tabular">
                  <Money minor={s.valueMinor} decimals={0} />
                </span>
                {s.children?.length ? <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-label={t(s.id === OTHER_SLOT ? 'charts.otherParts' : 'charts.hasParts')} /> : <span className="w-4 shrink-0" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
