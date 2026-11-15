import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LogOut, UserPlus } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { Badge, Button, Card, CardTitle, ErrorState, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { CopyLink } from '../../components/CopyLink';
import { ConfirmSheet } from '../../components/Confirm';
import { DateText } from '../../components/DateText';
import { useIsOwner, useMe } from '../../lib/session';
import { useApiMutation } from '../../lib/mutate';
import { useSignOut } from '../auth/useSignOut';
import { DataControl } from './DataControl';
import type { Role } from '../../../shared/schemas/me';

const ROLES: Role[] = ['owner', 'member', 'viewer'];

interface Member {
  userId: string;
  displayName: string;
  role: Role;
  joinedAt: string;
  passkeys: number;
}
interface Invite {
  id: string;
  kind: string;
  role: Role | null;
  email: string | null;
  createdAt: string;
  expiresAt: string;
}

function SwitchHousehold() {
  const { t } = useTranslation();
  const me = useMe()!;
  const qc = useQueryClient();
  if (me.households.length < 2) return null;
  return (
    <Card>
      <CardTitle>{t('auth.switchHousehold')}</CardTitle>
      <Select
        aria-label={t('auth.switchHousehold')}
        data-testid="household-switch"
        value={me.active?.id}
        onChange={async (e) => {
          await post('/api/session/household', { id: e.target.value });
          await qc.invalidateQueries();
        }}
      >
        {me.households.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </Select>
    </Card>
  );
}

function HouseholdName() {
  const { t } = useTranslation();
  const me = useMe()!;
  const [name, setName] = useState(me.active?.name ?? '');
  const save = useApiMutation((n: string) => patch('/api/household', { name: n }), { invalidate: [['me']], successKey: 'household.saved' });
  return (
    <Card>
      <CardTitle>{t('household.settings')}</CardTitle>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(name.trim());
        }}
      >
        <div className="flex-1">
          <Field label={t('household.name')} htmlFor="hh-name">
            <Input id="hh-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" busy={save.isPending} disabled={!name.trim()}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}

function Members() {
  const { t } = useTranslation();
  const me = useMe()!;
  const owner = useIsOwner();
  const q = useQuery({ queryKey: ['members'], queryFn: () => get<{ members: Member[] }>('/api/household/members') });
  const [removing, setRemoving] = useState<Member | null>(null);
  const [recovery, setRecovery] = useState<{ userId: string; link: string } | null>(null);
  const setRole = useApiMutation((v: { userId: string; role: Role }) => patch(`/api/household/members/${v.userId}`, { role: v.role }), { invalidate: [['members'], ['me']] });
  const remove = useApiMutation((userId: string) => del(`/api/household/members/${userId}`), { invalidate: [['members'], ['me']] });
  const rec = useApiMutation((userId: string) => post<{ link: string }>(`/api/household/members/${userId}/recovery`), { onSuccess: (r, userId) => setRecovery({ userId, link: r.link }) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Card>
      <CardTitle>{t('household.members')}</CardTitle>
      <ul className="divide-y divide-border" data-testid="members-list">
        {q.data.members.map((m) => (
          <li key={m.userId} className="flex flex-col gap-2 py-3" data-testid="member-row">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  <bdi>{m.displayName}</bdi> {m.userId === me.user.id && <span className="text-sm text-muted">({t('household.you')})</span>}
                </div>
                <div className="text-xs text-muted">{t('household.passkeysCount', { count: m.passkeys })}</div>
              </div>
              {owner ? (
                <div className="w-32 shrink-0">
                <Select aria-label={t('household.changeRole')} value={m.role} data-testid="member-role" onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value as Role })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
                </div>
              ) : (
                <Badge>{t(`roles.${m.role}`)}</Badge>
              )}
            </div>
            {owner && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => rec.mutate(m.userId)}>
                  {t('household.recover')}
                </Button>
                {m.userId !== me.user.id && (
                  <Button size="sm" variant="ghost" className="text-bad" onClick={() => setRemoving(m)}>
                    {t('household.remove')}
                  </Button>
                )}
              </div>
            )}
            {recovery?.userId === m.userId && <CopyLink link={recovery.link} label={t('household.recoveryReady')} testId="recovery-link" />}
          </li>
        ))}
      </ul>
      <ConfirmSheet
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={t('household.remove')}
        body={t('household.removeConfirm', { name: removing?.displayName ?? '' })}
        confirmLabel={t('household.remove')}
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.userId);
        }}
      />
    </Card>
  );
}

function Invites() {
  const { t } = useTranslation();
  const [role, setRole] = useState<'member' | 'viewer'>('member');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['invites'], queryFn: () => get<{ invites: Invite[] }>('/api/household/invites') });
  const create = useApiMutation(() => post<{ link: string }>('/api/household/invites', { role, ...(email.trim() ? { email: email.trim() } : {}) }), {
    invalidate: [['invites']],
    onSuccess: (r) => setLink(r.link),
  });
  const revoke = useApiMutation((id: string) => del(`/api/household/invites/${id}`), { invalidate: [['invites']] });
  return (
    <Card>
      <CardTitle>{t('household.invite')}</CardTitle>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined);
        }}
      >
        <Field label={t('household.inviteRole')} htmlFor="inv-role">
          <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'viewer')} data-testid="invite-role">
            <option value="member">{t('roles.member')}</option>
            <option value="viewer">{t('roles.viewer')}</option>
          </Select>
        </Field>
        <Field label={t('household.inviteEmail')} hint={t('household.inviteEmailHint')} htmlFor="inv-email">
          <Input id="inv-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" busy={create.isPending} data-testid="create-invite">
          <UserPlus className="size-5" aria-hidden />
          {t('household.createLink')}
        </Button>
      </form>
      {link && (
        <div className="mt-3">
          <CopyLink link={link} label={t('household.linkReady')} />
        </div>
      )}
      <h3 className="mb-2 mt-5 text-sm font-semibold text-muted">{t('household.invites')}</h3>
      {q.data && q.data.invites.length === 0 && <p className="text-sm text-muted">{t('household.noInvites')}</p>}
      <ul className="divide-y divide-border">
        {q.data?.invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm" data-testid="invite-row">
            <div>
              <Badge>{t(i.kind === 'recovery' ? 'household.recoveryLink' : `roles.${i.role ?? 'member'}`)}</Badge>{' '}
              <span className="text-muted">
                {t('household.expires')} <DateText date={i.expiresAt.slice(0, 10)} />
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
              {t('household.revoke')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SessionCard() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void signOut(false)} data-testid="sign-out">
          <LogOut className="size-5 rtl:-scale-x-100" aria-hidden />
          {t('auth.signOut')}
        </Button>
        <Button variant="ghost" onClick={() => void signOut(true)} data-testid="sign-out-all">
          {t('auth.signOutAll')}
        </Button>
      </div>
    </Card>
  );
}

export function Component() {
  const { t } = useTranslation();
  const owner = useIsOwner();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('household.title')} />
      <SwitchHousehold />
      {owner && <HouseholdName />}
      <Members />
      {owner && <Invites />}
      <SessionCard />
      {owner && <DataControl />}
    </div>
  );
}
