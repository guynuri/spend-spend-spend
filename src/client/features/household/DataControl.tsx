import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { del, post } from '../../api';
import { Button, Card, CardTitle } from '../../components/ui';
import { ConfirmSheet } from '../../components/Confirm';
import { useMe } from '../../lib/session';

/** Owner: reset or delete the household with a typed confirmation (AC15.1). */
export function DataControl() {
  const { t } = useTranslation();
  const me = useMe()!;
  const qc = useQueryClient();
  const nav = useNavigate();
  const [mode, setMode] = useState<'reset' | 'delete' | null>(null);
  const name = me.active?.name ?? '';
  return (
    <Card className="border-bad/30">
      <CardTitle>{t('data.title')}</CardTitle>
      <div className="flex flex-col gap-3">
        <div>
          <p className="mb-2 text-sm text-muted">{t('data.resetBody')}</p>
          <Button variant="secondary" onClick={() => setMode('reset')} data-testid="data-reset">
            {t('data.reset')}
          </Button>
        </div>
        <div>
          <p className="mb-2 text-sm text-muted">{t('data.deleteBody')}</p>
          <Button variant="danger" onClick={() => setMode('delete')} data-testid="data-delete">
            {t('data.delete')}
          </Button>
        </div>
      </div>
      <ConfirmSheet
        open={!!mode}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode === 'delete' ? t('data.delete') : t('data.reset')}
        body={t('data.typeName', { name })}
        typed={name}
        confirmLabel={mode === 'delete' ? t('data.delete') : t('data.reset')}
        testId="data-confirm"
        onConfirm={async () => {
          if (mode === 'delete') {
            await del('/api/household', { confirm: name });
            await qc.invalidateQueries();
            nav('/');
          } else {
            await post('/api/household/reset', { confirm: name });
            await qc.invalidateQueries();
          }
        }}
      />
    </Card>
  );
}
