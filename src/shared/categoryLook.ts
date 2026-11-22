/**
 * How a category looks: a colour slot (one of the validated categorical hues in styles.css, --mz-cat-1..8)
 * and an emoji. Stored on the category (`categories.color`, `categories.emoji`) so a category keeps its
 * colour on every chart, whatever its rank. A category without a stored colour gets a stable one from
 * its id.
 */
export const COLOR_SLOTS = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8'] as const;
export type ColorSlot = (typeof COLOR_SLOTS)[number];
export const OTHER_SLOT = 'cat-other';

export const isColorSlot = (v: unknown): v is ColorSlot => typeof v === 'string' && (COLOR_SLOTS as readonly string[]).includes(v);

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The category's slot: its stored colour, else a stable pick from its id. */
export const colorSlotOf = (c: { id: string; color?: string | null }): ColorSlot => (isColorSlot(c.color) ? c.color : COLOR_SLOTS[hash(c.id) % COLOR_SLOTS.length]!);
export const slotVar = (slot: string) => `var(--mz-${slot})`;
