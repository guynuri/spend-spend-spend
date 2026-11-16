import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { get, post } from '../api';
import { useApiMutation } from '../lib/mutate';
import type { Category } from '../../shared/schemas/ledger';
import { Sheet } from './Sheet';
import { Button, Field, Input, Select } from './ui';

type Kind = Category['kind'];
interface Suggestion {
  key: string;
  en: string;
  he: string;
  kind: Kind;
}

/** Add a category: one tap from the suggested catalog, or a custom name. */
export function AddCategorySheet({ open, onOpenChange, kinds = ['expense', 'income', 'transfer'], onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; kinds?: Kind[]; onAdded?: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>(kinds[0]!);
  const sq = useQuery({ queryKey: ['categories', 'suggestions'], queryFn: () => get<{ suggestions: Suggestion[] }>('/api/categories/suggestions'), enabled: open });
  const done = (r: { id: string }) => {
    setName('');
    onOpenChange(false);
    onAdded?.(r.id);
  };
  const pick = useApiMutation((key: string) => post<{ id: string }>(`/api/categories/suggestions/${key}`), { invalidate: [['categories']], onSuccess: done, successKey: 'ledger.saved' });
  const custom = useApiMutation(() => post<{ id: string }>('/api/categories', { name: name.trim(), kind }), { invalidate: [['categories']], onSuccess: done, successKey: 'ledger.saved' });
  const sugg = (sq.data?.suggestions ?? []).filter((s) => kinds.includes(s.kind));
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('categories.add')} testId="add-category-sheet">
      <div className="flex flex-col gap-4">
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
                    className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-dashed border-border px-3 text-sm hover:bg-surface-2"
                    data-testid="category-suggestion"
                  >
                    <Plus className="size-4 text-accent" aria-hidden />
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
          <h3 className="text-sm font-medium text-muted">{t('categories.custom')}</h3>
          <Field label={t('categories.name')} htmlFor="new-cat-name">
            <Input id="new-cat-name" dir="auto" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} data-testid="category-name" />
          </Field>
          {kinds.length > 1 && (
            <Field label={t('categories.kind')} htmlFor="new-cat-kind">
              <Select id="new-cat-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`categories.kinds.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button type="submit" className="self-end" disabled={!name.trim()} busy={custom.isPending} data-testid="category-save">
            {t('common.save')}
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
