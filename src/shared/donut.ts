import { COLOR_SLOTS, OTHER_SLOT } from './categoryLook';

export interface DonutInput {
  id: string;
  label: string;
  valueMinor: number;
  slot: string;
  emoji?: string | null;
  /** A ready CSS colour that wins over `slot` (used for the shades of a parent's subcategories). */
  color?: string;
  /** Parts of this slice (a category's subcategories): tapping it opens a ring of these. */
  children?: DonutInput[];
}
export type DonutSlice = DonutInput;

/**
 * Slices for the spending ring: positive amounts only, largest first, the first `max` kept and the rest
 * folded into one "Other" slice (never a generated colour). A category keeps its own colour; when two
 * shown categories share one, the later takes a colour no shown category owns, so no two slices on
 * the ring look alike.
 */
export function donutSlices(items: DonutInput[], max: number, otherLabel: string): DonutSlice[] {
  const pos = items.filter((i) => i.valueMinor > 0).sort((a, b) => b.valueMinor - a.valueMinor || a.label.localeCompare(b.label));
  const fold = pos.length > max + 1;
  const shown = fold ? pos.slice(0, max) : pos;
  // Every shown category's own colour is reserved first, so resolving a clash never takes another's colour.
  const own = new Set<string>(shown.map((i) => i.slot));
  // the folded tail owns the grey, so a shown grey category (e.g. unsplit card charges) takes a free hue
  const used = new Set<string>(fold ? [OTHER_SLOT] : []);
  const out: DonutSlice[] = shown.map((i) => {
    let slot: string = i.slot;
    if (used.has(slot)) slot = COLOR_SLOTS.find((s) => !used.has(s) && !own.has(s)) ?? COLOR_SLOTS.find((s) => !used.has(s)) ?? slot;
    used.add(slot);
    return { ...i, slot };
  });
  if (fold) out.push({ id: OTHER_SLOT, label: otherLabel, valueMinor: pos.slice(max).reduce((a, i) => a + i.valueMinor, 0), slot: OTHER_SLOT });
  return out;
}

/**
 * Arc lengths for `values` on a ring of length `total`: proportional, but every slice gets at least
 * `min` (so a 1 % slice stays a visible pill instead of a dot on top of its neighbour); what the small
 * ones gain is taken from the others in proportion to their size.
 */
export function arcLengths(values: number[], total: number, min: number): number[] {
  const sum = values.reduce((a, v) => a + Math.max(0, v), 0);
  if (sum <= 0 || !values.length) return values.map(() => 0);
  if (min * values.length >= total) return values.map(() => total / values.length);
  let out = values.map((v) => (Math.max(0, v) / sum) * total);
  for (let pass = 0; pass < values.length; pass++) {
    const small = out.map((l) => l < min);
    if (!small.some(Boolean)) break;
    const fixed = small.filter(Boolean).length * min;
    const restSum = out.reduce((a, l, k) => a + (small[k] ? 0 : l), 0);
    const scale = restSum > 0 ? (total - fixed) / restSum : 0;
    out = out.map((l, k) => (small[k] ? min : l * scale));
  }
  return out;
}

/** Shades of one colour for a parent's parts: full colour first, lighter (mixed with the surface) after. */
export function shades(base: string, n: number): string[] {
  return Array.from({ length: n }, (_, k) => (k === 0 ? base : `color-mix(in srgb, ${base} ${Math.round(100 - (k * 60) / Math.max(1, n - 1))}%, var(--mz-surface))`));
}
