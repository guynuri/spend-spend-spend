import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { COLOR_SLOTS, isEmoji, slotVar } from '../../shared/categoryLook';
import { cx, Input } from './ui';

/** A short, friendly set to tap; any other emoji can be typed. */
const EMOJIS = [
  '🛒', '🍕', '☕', '🍔', '🥗', '🍷', '🏠', '🛋️', '💡', '🔥', '💧', '📱',
  '🚗', '⛽', '🚌', '🅿️', '✈️', '🏖️', '🎁', '🎉', '🎟️', '🎬', '🎮', '📚',
  '👕', '👟', '💅', '💇', '🩺', '💊', '🏋️', '⚽', '🐾', '🧸', '👶', '🎓',
  '🛡️', '🧾', '🏦', '💳', '💵', '💼', '🐷', '🔁', '🔧', '🌱', '❤️', '📦',
];

/** Emoji + colour for a category. `emoji` null = none (a colour dot is shown instead). */
export function LookPicker({ emoji, color, onEmoji, onColor }: { emoji: string | null; color: string | null; onEmoji: (v: string | null) => void; onColor: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" data-testid="look-picker">
      <div>
        <p className="mb-2 text-sm font-medium">{t('categories.look.color')}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('categories.look.color')}>
          {COLOR_SLOTS.map((s, i) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={color === s}
              aria-label={t('categories.look.colorN', { n: i + 1 })}
              onClick={() => onColor(s)}
              className={cx('flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition', color === s && 'ring-2 ring-text')}
              style={{ background: slotVar(s) }}
              data-testid="look-color"
            >
              {color === s && <Check className="size-4 text-white" aria-hidden />}
            </button>
          ))}
        </div>
      </div>
      <EmojiPicker emoji={emoji} onEmoji={onEmoji} />
    </div>
  );
}

/** The emoji part alone: a friendly grid to tap, or type any emoji. */
export function EmojiPicker({ emoji, onEmoji }: { emoji: string | null; onEmoji: (v: string | null) => void }) {
  const { t } = useTranslation();
  const [own, setOwn] = useState('');
  const ownOk = isEmoji(own);
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{t('categories.look.emoji')}</p>
      <div className="grid grid-cols-8 gap-1" role="radiogroup" aria-label={t('categories.look.emoji')}>
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={emoji === e}
            onClick={() => onEmoji(emoji === e ? null : e)}
            className={cx('flex aspect-square items-center justify-center rounded-xl text-xl transition', emoji === e ? 'bg-accent/15 ring-2 ring-accent' : 'hover:bg-surface-2')}
            data-testid="look-emoji"
          >
            {e}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input value={own} onChange={(e) => setOwn(e.target.value)} placeholder={t('categories.look.typeEmoji')} className="w-40" aria-label={t('categories.look.typeEmoji')} data-testid="look-emoji-own" />
        <button type="button" disabled={!ownOk} onClick={() => onEmoji(own.trim())} className="min-h-11 rounded-2xl px-3 text-sm font-medium text-accent disabled:opacity-40">
          {t('categories.look.use')}
        </button>
        {emoji && (
          <button type="button" onClick={() => onEmoji(null)} className="ms-auto min-h-11 px-2 text-sm text-muted">
            {t('categories.look.noEmoji')}
          </button>
        )}
      </div>
    </div>
  );
}
