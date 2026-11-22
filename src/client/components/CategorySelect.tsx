import { forwardRef, useState, type SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../lib/queries';
import { useCanWrite } from '../lib/session';
import { AddCategorySheet } from './AddCategorySheet';
import { categoryLabel } from './CategoryIcon';
import { Select } from './ui';

const ADD = '__add__';

/**
 * Category picker grouped by kind; archived categories hidden unless currently selected.
 * Pickers that assign a category (no `emptyLabel`, i.e. not filters) end with "+ Add category…".
 */
export const CategorySelect = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & { value: string | null; onChange: (id: string | null) => void; emptyLabel?: string; kinds?: ('income' | 'expense' | 'transfer')[]; extra?: { value: string; label: string }[] }>(
  /** `extra`: options listed right after the empty one (filters only, e.g. "General expenses"). */
  function CategorySelect({ value, onChange, emptyLabel, kinds, extra, ...rest }, ref) {
    const { t } = useTranslation();
    const q = useCategories();
    const canWrite = useCanWrite();
    const [adding, setAdding] = useState(false);
    const cats = (q.data?.categories ?? []).filter((c) => (!c.archived || c.id === value) && (!kinds || kinds.includes(c.kind)));
    const groups = (['expense', 'income', 'transfer'] as const).filter((k) => cats.some((c) => c.kind === k));
    return (
      <>
        <Select ref={ref} value={value ?? ''} onChange={(e) => (e.target.value === ADD ? setAdding(true) : onChange(e.target.value || null))} {...rest}>
          <option value="">{emptyLabel ?? t('ledger.uncategorized')}</option>
          {extra?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {groups.map((g) => (
            <optgroup key={g} label={t(`categories.kinds.${g}`)}>
              {cats
                .filter((c) => c.kind === g && (!c.parentId || !cats.some((p) => p.id === c.parentId)))
                .flatMap((c) => [c, ...cats.filter((s) => s.parentId === c.id)])
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {/* subcategories indented under their parent */}
                    {c.parentId ? `\u2003${categoryLabel(c)}` : categoryLabel(c)}
                  </option>
                ))}
            </optgroup>
          ))}
          {canWrite && emptyLabel === undefined && <option value={ADD}>{t('categories.addOption')}</option>}
        </Select>
        {adding && <AddCategorySheet open onOpenChange={setAdding} kinds={kinds} onAdded={(id) => onChange(id)} />}
      </>
    );
  },
);
