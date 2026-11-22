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
/** Stored colours: the eight hues, or the neutral grey kept for system / catch-all categories. */
const isStored = (v: unknown): v is string => isColorSlot(v) || v === OTHER_SLOT;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The category's slot: its stored colour, else a stable pick from its id. */
export const colorSlotOf = (c: { id: string; color?: string | null }): string => (isStored(c.color) ? c.color : COLOR_SLOTS[hash(c.id) % COLOR_SLOTS.length]!);
export const slotVar = (slot: string) => `var(--mz-${slot})`;

/** One emoji (flags, skin tones and ZWJ sequences included), no letters, digits or spaces; ≤ 16 code units. */
export function isEmoji(v: string): boolean {
  const x = v.trim();
  if (!x || x.length > 16) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(x) && !/[\p{L}\p{N}\s]/u.test(x.replace(/\u{FE0F}|\u{200D}|\u{20E3}|\p{Emoji_Modifier}/gu, ''));
}
