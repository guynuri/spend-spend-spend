import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { get, patch, post } from '../../api';
import { Badge, Button, Card, CardTitle, ErrorState, Field, Input, PageHeader, Spinner } from '../../components/ui';
import { CopyLink } from '../../components/CopyLink';
import { DateText } from '../../components/DateText';
import { useMe } from '../../lib/session';
import { useApiMutation } from '../../lib/mutate';
import { SessionCard } from '../household/page';

interface AdminHousehold {
  id: string;
  name: string;
  status: 'active' | 'disabled';
  memberCount: number;
  createdAt: string;
  lastImportAt: string | null;
  owners: { id: string; name: string }[];
}

export function Component() {
  const { t } = useTranslation();
  const me = useMe();
  const [name, setName] = useState('');
  const [links, setLinks] = useState<Record<string, { label: string; link: string }>>({});
  const q = useQuery({ queryKey: ['admin-households'], queryFn: () => get<{ households: AdminHousehold[] }>('/api/admin/households'), enabled: !!me?.user.isSuperAdmin });
  const create = useApiMutation((n: string) => post<{ id: string; invite: { link: string } }>('/api/admin/households', { name: n, locale: 'he' }), {
    invalidate: [['admin-households']],
    onSuccess: (r) => {
      setName('');
      setLinks((l) => ({ ...l, [r.id]: { label: t('admin.ownerLink'), link: r.invite.link } }));
    },
  });
  const ownerLink = useApiMutation((id: string) => post<{ invite: { link: string } }>(`/api/admin/households/${id}/owner-invite`), {
    onSuccess: (r, id) => setLinks((l) => ({ ...l, [id]: { label: t('admin.ownerLink'), link: r.invite.link } })),
  });
  const recovery = useApiMutation((v: { hid: string; uid: string }) => post<{ link: string }>(`/api/admin/users/${v.uid}/recovery`), {
    onSuccess: (r, v) => setLinks((l) => ({ ...l, [v.hid]: { label: t('household.recoveryReady'), link: r.link } })),
  });
  const setStatus = useApiMutation((v: { id: string; status: 'active' | 'disabled' }) => patch(`/api/admin/households/${v.id}`, { status: v.status }), { invalidate: [['admin-households']] });

  if (me && !me.user.isSuperAdmin) return <Navigate to="/" replace />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('admin.title')} />
      <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm text-muted">
        <ShieldCheck className="size-5 shrink-0 text-accent" aria-hidden />
        {t('admin.privacy')}
      </p>
      <Card>
        <CardTitle>{t('admin.create')}</CardTitle>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(name.trim());
          }}
        >
          <div className="flex-1">
            <Field label={t('admin.name')} htmlFor="new-hh">
              <Input id="new-hh" data-testid="admin-household-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" busy={create.isPending} disabled={!name.trim()} data-testid="admin-create-household">
            {t('common.add')}
          </Button>
        </form>
      </Card>
      <Card>
        <CardTitle>{t('admin.households')}</CardTitle>
        {q.isPending ? (
          <Spinner />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.households.map((h) => (
              <li key={h.id} className="flex flex-col gap-2 py-3" data-testid="admin-household-row">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium" dir="auto">
                    {h.name}
                  </span>
                  <Badge tone={h.status === 'active' ? 'good' : 'neutral'}>{t(`admin.${h.status}`)}</Badge>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs text-muted">
                  <div>
                    <dt>{t('admin.members')}</dt>
                    <dd className="tabular text-text">{h.memberCount}</dd>
                  </div>
                  <div>
                    <dt>{t('admin.created')}</dt>
                    <dd className="text-text">
                      <DateText date={h.createdAt.slice(0, 10)} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t('admin.lastImport')}</dt>
                    <dd className="text-text">{h.lastImportAt ? <DateText date={h.lastImportAt.slice(0, 10)} /> : t('admin.never')}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => ownerLink.mutate(h.id)} data-testid="admin-owner-link">
                    {t('admin.newOwnerLink')}
                  </Button>
                  {h.owners[0] && (
                    <Button size="sm" variant="secondary" onClick={() => recovery.mutate({ hid: h.id, uid: h.owners[0]!.id })}>
                      {t('admin.ownerRecovery')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: h.id, status: h.status === 'active' ? 'disabled' : 'active' })}>
                    {t(h.status === 'active' ? 'admin.disable' : 'admin.enable')}
                  </Button>
                </div>
                {links[h.id] && <CopyLink link={links[h.id]!.link} label={links[h.id]!.label} testId="admin-link" />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!me?.active && <SessionCard />}
    </div>
  );
}
