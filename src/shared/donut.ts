import { COLOR_SLOTS, OTHER_SLOT } from './categoryLook';

export interface DonutInput {
  id: string;
  label: string;
  valueMinor: number;
  slot: string;
  emoji?: string | null;
}
export interface DonutSlice {
  id: string;
  label: string;
  valueMinor: number;
  slot: string;
  emoji?: string | null;
}

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
    return { id: i.id, label: i.label, valueMinor: i.valueMinor, slot, ...(i.emoji ? { emoji: i.emoji } : {}) };
  });
  if (fold) out.push({ id: OTHER_SLOT, label: otherLabel, valueMinor: pos.slice(max).reduce((a, i) => a + i.valueMinor, 0), slot: OTHER_SLOT });
  return out;
}
