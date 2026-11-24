import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical } from 'lucide-react';
import { cx } from './ui';

interface Drag {
  from: number;
  to: number;
  dy: number;
  /** How far the others move to make room: the dragged row's height plus the gap. */
  step: number;
}

/** Near the top or bottom edge (px; the bottom leaves room for the phone's tab bar) the page scrolls while dragging. */
const EDGE_TOP = 72;
const EDGE_BOTTOM = 110;
const SCROLL_SPEED = 10;

/**
 * A vertical list the user reorders by dragging a row's grip (mouse, finger or pen), or with the arrow
 * keys on the focused grip. No library: pointer capture on the grip, the dragged row follows the pointer,
 * the rows it passes slide out of the way, and the page scrolls near the edges. `onMove(from, to)` fires
 * once, on release.
 */
export function SortableList<T extends string>({
  ids,
  label,
  onMove,
  render,
  testId,
}: {
  ids: T[];
  /** A row's name, for the grip's label and the position announcement. */
  label: (id: T) => string;
  onMove: (from: number, to: number) => void;
  /** The row's content; `grip` is the drag handle to place in it. */
  render: (id: T, grip: ReactNode) => ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState('');
  const g = useRef<{ startY: number; startScroll: number; lastY: number; centers: number[]; top: number; h: number; raf: number; d: Drag } | null>(null);

  // stop the edge-scroll loop if the list unmounts mid-drag
  useEffect(() => () => cancelAnimationFrame(g.current?.raf ?? 0), []);

  const update = () => {
    const s = g.current;
    if (!s) return;
    const dy = s.lastY - s.startY + (window.scrollY - s.startScroll);
    const mid = s.top + s.h / 2 + dy;
    let to = s.d.from;
    s.centers.forEach((c, i) => {
      if (i > s.d.from && mid > c) to = i;
      if (i < s.d.from && mid < c && i < to) to = i;
    });
    s.d = { ...s.d, dy, to };
    setDrag(s.d);
  };
  const loop = () => {
    const s = g.current;
    if (!s) return;
    const y = s.lastY;
    const dir = y < EDGE_TOP ? -1 : y > window.innerHeight - EDGE_BOTTOM ? 1 : 0;
    if (dir) {
      window.scrollBy(0, dir * SCROLL_SPEED);
      update();
    }
    s.raf = requestAnimationFrame(loop);
  };

  const down = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rows = [...(list.current?.children ?? [])].map((el) => el.getBoundingClientRect());
    const r = rows[i];
    if (!r) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const next = rows[1] && rows[0] ? rows[1].top - rows[0].bottom : 0;
    const d: Drag = { from: i, to: i, dy: 0, step: r.height + Math.max(0, next) };
    g.current = { startY: e.clientY, startScroll: window.scrollY, lastY: e.clientY, centers: rows.map((x) => x.top + x.height / 2), top: r.top, h: r.height, raf: 0, d };
    g.current.raf = requestAnimationFrame(loop);
    setDrag(d);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!g.current) return;
    g.current.lastY = e.clientY;
    update();
  };
  const up = () => {
    const s = g.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    g.current = null;
    setDrag(null);
    if (s.d.to !== s.d.from) {
      onMove(s.d.from, s.d.to);
      setSaid(t('sortable.moved', { name: label(ids[s.d.from]!), n: s.d.to + 1, total: ids.length }));
    }
  };
  const key = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
    if (to < 0 || to >= ids.length) return;
    e.preventDefault();
    onMove(i, to);
    setSaid(t('sortable.moved', { name: label(ids[i]!), n: to + 1, total: ids.length }));
  };

  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.step;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.step;
    return 0;
  };
  return (
    <>
      <ul ref={list} className="flex flex-col gap-2" data-testid={testId}>
        {ids.map((id, i) => {
          const dragging = drag?.from === i;
          const grip = (
            <button
              type="button"
              className="inline-flex size-11 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-xl text-muted hover:bg-surface-2 active:cursor-grabbing"
              aria-label={t('sortable.grip', { name: label(id) })}
              aria-describedby="sortable-hint"
              onPointerDown={down(i)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onLostPointerCapture={up}
              onKeyDown={key(i)}
              data-testid="sortable-grip"
            >
              <GripVertical className="size-5" aria-hidden />
            </button>
          );
          return (
            <li
              key={id}
              data-id={id}
              className={cx('relative', dragging && 'z-10')}
              style={{
                transform: dragging ? `translateY(${drag.dy}px) scale(1.02)` : `translateY(${shift(i)}px)`,
                // only while dragging: on release the order changes and the offsets go in the same frame
                transition: drag && !dragging ? 'transform 160ms ease' : undefined,
              }}
            >
              <div className={cx('rounded-2xl transition-shadow', dragging && 'shadow-[var(--mz-shadow-lg,0_12px_32px_rgb(0_0_0/0.18))]')}>{render(id, grip)}</div>
            </li>
          );
        })}
      </ul>
      <p id="sortable-hint" className="sr-only">
        {t('sortable.hint')}
      </p>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </>
  );
}
