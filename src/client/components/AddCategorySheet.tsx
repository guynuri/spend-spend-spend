import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus } from 'lucide-react';
import { get, post } from '../api';
import { useApiMutation } from '../lib/mutate';
import { useCategories } from '../lib/queries';
import type { Category } from '../../shared/schemas/ledger';
import { COLOR_SLOTS, colorSlotOf } from '../../shared/categoryLook';
import { Sheet } from './Sheet';
import { Button, Field, Input, Select, Spinner } from './ui';
import { CategoryIcon, categoryLabel } from './CategoryIcon';
import { EmojiPicker, LookPicker } from './LookPicker';

type Kind = Category['kind'];
interface Suggestion {
  key: string;
  en: string;
  he: string;
  kind: Kind;
  emoji?: string;
  color?: string;
}

/**
 * Add a category: one tap from the suggested catalog, or your own (name, emoji, colour, and optionally
 * inside a top-level category). With `parent` it adds a subcategory of that category.
 */
export function AddCategorySheet({ open, onOpenChange, kinds = ['expense', 'income', 'transfer'], onAdded, parent }: { open: boolean; onOpenChange: (v: boolean) => void; kinds?: Kind[]; onAdded?: (id: string) => void; parent?: Category }) {
  const { t, i18n } = useTranslation();
  const all = useCategories().data?.categories ?? [];
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>(parent?.kind ?? kinds[0]!);
  const [parentId, setParentId] = useState<string | null>(parent?.id ?? null);
  const [emoji, setEmoji] = useState<string | null>(null);
  // a new category starts in a colour few others use
  const [showColor, setShowColor] = useState(false);
  const [color, setColor] = useState<string>(() => {
    if (parent) return colorSlotOf(parent);
    const used = new Map<string, number>();
    for (const c of all) if (c.color) used.set(c.color, (used.get(c.color) ?? 0) + 1);
    return [...COLOR_SLOTS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]!;
  });
  const sq = useQuery({ queryKey: ['categories', 'suggestions'], queryFn: () => get<{ suggestions: Suggestion[] }>('/api/categories/suggestions'), enabled: open && !parent });
  const done = (r: { id: string }) => {
    setName('');
    onOpenChange(false);
    onAdded?.(r.id);
  };
  const pick = useApiMutation((key: string) => post<{ id: string }>(`/api/categories/suggestions/${key}`), { invalidate: [['categories']], onSuccess: done, successKey: 'ledger.saved' });
  const custom = useApiMutation(() => post<{ id: string }>('/api/categories', { name: name.trim(), kind, color, ...(emoji ? { emoji } : {}), ...(parentId ? { parentId } : {}) }), {
    invalidate: [['categories']],
    onSuccess: done,
    successKey: 'ledger.saved',
  });
  const sugg = parent ? [] : (sq.data?.suggestions ?? []).filter((s) => kinds.includes(s.kind));
  const parents = all.filter((c) => c.kind === kind && !c.parentId && !c.systemKey && !c.archived);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={parent ? t('categories.addSubTo', { name: parent.name }) : t('categories.add')} testId="add-category-sheet">
      <div className="flex flex-col gap-4">
        {!parent && sq.isPending && <Spinner className="p-2" />}
        {sugg.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium text-muted">{t('categories.suggested')}</h3>
            <ul className="flex flex-wrap gap-2">
              {sugg.map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    disabled={pick.isPending}
                    onClick={() => pick.mutate(s.key)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-dashed border-border px-3 text-sm hover:bg-surface-2"
                    data-testid="category-suggestion"
                  >
                    {pick.isPending && pick.variables === s.key ? <Loader2 className="size-4 animate-spin text-accent" aria-hidden /> : s.emoji ? <span aria-hidden>{s.emoji}</span> : <Plus className="size-4 text-accent" aria-hidden />}
                    {i18n.language === 'he' ? s.he : s.en}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            custom.mutate(undefined);
          }}
        >
          {!parent && <h3 className="text-sm font-medium text-muted">{t('categories.custom')}</h3>}
          <div className="flex items-end gap-3">
            <CategoryIcon cat={{ id: 'new', color, emoji }} size="lg" />
            <div className="min-w-0 flex-1">
              <Field label={t('categories.name')} htmlFor="new-cat-name">
                <Input id="new-cat-name" dir="auto" maxLength={40} autoFocus={!!parent} value={name} onChange={(e) => setName(e.target.value)} data-testid="category-name" />
              </Field>
            </div>
          </div>
          {!parent && kinds.length > 1 && (
            <Field label={t('categories.kind')} htmlFor="new-cat-kind">
              <Select
                id="new-cat-kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as Kind);
                  setParentId(null);
                }}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`categories.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!parent && parents.length > 0 && (
            <Field label={t('categories.parent')} htmlFor="new-cat-parent" hint={t('categories.parentHint')}>
              <Select id="new-cat-parent" value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)} data-testid="category-parent">
                <option value="">{t('categories.topLevel')}</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {categoryLabel(p)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {parent && !showColor ? (
            // a subcategory: just a name and an emoji; it takes the parent's colour unless you change it
            <>
              <EmojiPicker emoji={emoji} onEmoji={setEmoji} />
              <button type="button" onClick={() => setShowColor(true)} className="min-h-11 self-start text-sm font-medium text-accent" data-testid="sub-color">
                {t('categories.look.changeColor')}
              </button>
            </>
          ) : (
            <LookPicker emoji={emoji} color={color} onEmoji={setEmoji} onColor={setColor} />
          )}
          <Button type="submit" className="self-end" disabled={!name.trim()} busy={custom.isPending} data-testid="category-save">
            {t('common.save')}
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
