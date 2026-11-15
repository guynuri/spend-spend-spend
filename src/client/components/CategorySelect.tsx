import { forwardRef, type SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../lib/queries';
import { Select } from './ui';

/** Category picker grouped by kind; archived categories hidden unless currently selected. */
export const CategorySelect = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & { value: string | null; onChange: (id: string | null) => void; emptyLabel?: string; kinds?: ('income' | 'expense' | 'transfer')[] }>(
  function CategorySelect({ value, onChange, emptyLabel, kinds, ...rest }, ref) {
    const { t } = useTranslation();
    const q = useCategories();
    const cats = (q.data?.categories ?? []).filter((c) => (!c.archived || c.id === value) && (!kinds || kinds.includes(c.kind)));
    const groups = (['expense', 'income', 'transfer'] as const).filter((k) => cats.some((c) => c.kind === k));
    return (
      <Select ref={ref} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}>
        <option value="">{emptyLabel ?? t('ledger.uncategorized')}</option>
        {groups.map((g) => (
          <optgroup key={g} label={t(`categories.kinds.${g}`)}>
            {cats
              .filter((c) => c.kind === g)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
    );
  },
);
