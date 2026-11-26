import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get, patch } from '../../api';
import { Button, Card, CardTitle, ErrorState, Field, Input, Spinner } from '../../components/ui';
import { useApiMutation } from '../../lib/mutate';

type Kind = 'purchase' | 'file';
const LINK = /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}\/?$/;
const QK = ['admin-settings'];

/**
 * Super-admin (D-R34): the shared Shortcuts for every household. A shortcut carries no household and no
 * key (each person pastes their own when installing), so one link serves everyone; a household's owner
 * can still publish their own, which wins for that household.
 */
export function AppShortcuts() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: QK, queryFn: () => get<{ shortcutLinks: Record<Kind, string | null> }>('/api/admin/settings') });
  return (
    <Card data-testid="admin-shortcuts">
      <CardTitle>{t('admin.shortcuts.title')}</CardTitle>
      <p className="mb-3 text-sm text-muted">{t('admin.shortcuts.body')}</p>
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          {(['purchase', 'file'] as const).map((k) => (
            <LinkRow key={k} kind={k} link={q.data.shortcutLinks[k]} />
          ))}
        </div>
      )}
    </Card>
  );
}

function LinkRow({ kind, link }: { kind: Kind; link: string | null }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const field = kind === 'purchase' ? 'shortcutPurchaseLink' : 'shortcutFileLink';
  // every household's Settings shows the result, so refresh it too
  const save = useApiMutation((v: string | null) => patch('/api/admin/settings', { [field]: v }), { invalidate: [QK, ['household']], successKey: 'ledger.saved', onSuccess: () => setValue('') });
  const ok = LINK.test(value.trim());
  return (
    <div className="flex flex-col gap-2" data-testid={`admin-shortcut-${kind}`}>
      <span className="text-sm font-medium">{t(`admin.shortcuts.${kind}`)}</span>
      {link ? (
        <div className="flex items-center gap-2">
          <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 p-2 text-xs" data-testid={`admin-shortcut-current-${kind}`}>
            {link}
          </code>
          <Button size="sm" variant="ghost" className="text-bad" busy={save.isPendingWith((v) => v === null)} onClick={() => save.mutate(null)} data-testid={`admin-shortcut-remove-${kind}`}>
            {t('live.publish.remove')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted">{t('admin.shortcuts.none')}</p>
      )}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={t('live.publish.label')} htmlFor={`app-link-${kind}`} error={value.trim() && !ok ? t('live.publish.invalid') : undefined}>
            <Input id={`app-link-${kind}`} dir="ltr" inputMode="url" placeholder={t('live.publish.placeholder')} value={value} onChange={(e) => setValue(e.target.value)} data-testid={`admin-shortcut-input-${kind}`} />
          </Field>
        </div>
        <Button disabled={!ok} busy={save.isPendingWith((v) => v !== null)} onClick={() => save.mutate(value.trim())} data-testid={`admin-shortcut-save-${kind}`}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
