import { cx } from './ui';
import { colorSlotOf, slotVar } from '../../shared/categoryLook';

/** A category's emoji on a soft circle of its colour (a colour dot when it has no emoji). */
export function CategoryIcon({ cat, size = 'md', className }: { cat: { id: string; color?: string | null; emoji?: string | null } | null | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const slot = cat ? colorSlotOf(cat) : 'cat-other';
  const dim = size === 'sm' ? 'size-7 text-sm' : size === 'lg' ? 'size-12 text-2xl' : 'size-9 text-lg';
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-full leading-none', dim, className)} style={{ background: `color-mix(in srgb, ${slotVar(slot)} 18%, transparent)` }} aria-hidden>
      {cat?.emoji ?? <span className="size-2.5 rounded-full" style={{ background: slotVar(slot) }} />}
    </span>
  );
}

/** "🛒 Groceries" for places that only take text (select options, chart tooltips). */
export const categoryLabel = (c: { name: string; emoji?: string | null } | null | undefined) => (c ? (c.emoji ? `${c.emoji} ${c.name}` : c.name) : '');
