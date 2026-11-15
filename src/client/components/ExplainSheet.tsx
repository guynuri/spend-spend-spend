import { Info } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from './Sheet';

export interface ExplainRow {
  label: ReactNode;
  value: ReactNode;
  testId?: string;
}

/** "How is this calculated?" — formula plus the actual inputs used (PLAN §1 principle 2). */
export function ExplainSheet({ title, formula, rows, total, testId = 'explain', children }: { title: ReactNode; formula: ReactNode; rows: ExplainRow[]; total?: ExplainRow; testId?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid={`${testId}-open`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent">
        <Info className="size-4" aria-hidden />
        {t('explain.open')}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={title} testId={testId}>
        <h3 className="text-sm font-semibold text-muted">{t('explain.formula')}</h3>
        <p className="mb-4 mt-1 rounded-xl bg-surface-2 p-3 text-sm">{formula}</p>
        <h3 className="text-sm font-semibold text-muted">{t('explain.inputs')}</h3>
        <dl className="mt-1 divide-y divide-border">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid={r.testId}>
              <dt className="text-text">{r.label}</dt>
              <dd className="text-end font-medium">{r.value}</dd>
            </div>
          ))}
          {total && (
            <div className="flex items-center justify-between gap-3 py-2 text-base font-semibold" data-testid={total.testId}>
              <dt>{total.label}</dt>
              <dd className="text-end">{total.value}</dd>
            </div>
          )}
        </dl>
        {children}
      </Sheet>
    </>
  );
}
