import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { post } from '../api';
import { useIsOwner, useMe } from '../lib/session';
import { ConfirmSheet } from './Confirm';

/** Persistent banner while sample data is loaded; "Clear sample data" = household reset (AC14.1). */
export function SampleDataBanner() {
  const { t } = useTranslation();
  const me = useMe();
  const owner = useIsOwner();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  if (!me?.active?.hasSampleData) return null;
  return (
    <div className="flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-sm" data-testid="sample-banner">
      <FlaskConical className="size-4 shrink-0 text-accent" aria-hidden />
      <span className="flex-1">{t('onboarding.banner')}</span>
      {owner && (
        <button type="button" className="min-h-11 shrink-0 font-semibold text-accent" onClick={() => setOpen(true)} data-testid="sample-clear">
          {t('onboarding.clear')}
        </button>
      )}
      <ConfirmSheet
        open={open}
        onOpenChange={setOpen}
        title={t('onboarding.clear')}
        body={t('onboarding.clearConfirm')}
        confirmLabel={t('onboarding.clear')}
        testId="sample-clear-confirm"
        onConfirm={async () => {
          await post('/api/household/reset', { confirm: me.active!.name });
          await qc.invalidateQueries();
        }}
      />
    </div>
  );
}
