import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { KeyRound, Smartphone, Trash2 } from 'lucide-react';
import { del, get } from '../../api';
import { Badge, Button, Card, CardTitle, IconButton } from '../../components/ui';
import { useFormatDate } from '../../components/DateText';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { addPasskey } from '../../lib/passkey';
import { SessionCard } from '../household/page';

interface Pk {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}
interface Sess {
  id: string;
  current: boolean;
  lastSeenAt: string;
  device: string;
}

/** Passkey management (cannot remove the last one) and the signed-in device list. */
export function SecurityCard() {
  const { t } = useTranslation();
  const fmt = useFormatDate();
  const toast = useToast();
  const pk = useQuery({ queryKey: ['passkeys'], queryFn: () => get<{ passkeys: Pk[] }>('/api/auth/passkeys') });
  const ss = useQuery({ queryKey: ['sessions'], queryFn: () => get<{ sessions: Sess[] }>('/api/auth/sessions') });
  const remove = useApiMutation((id: string) => del(`/api/auth/passkeys/${id}`), { invalidate: [['passkeys']] });
  const add = useApiMutation(() => addPasskey(), { invalidate: [['passkeys']], onSuccess: () => toast({ title: t('security.passkeyAdded'), tone: 'good' }) });
  const list = pk.data?.passkeys ?? [];
  return (
    <>
      <Card data-testid="security-card">
        <CardTitle>{t('security.passkeys')}</CardTitle>
        <ul className="divide-y divide-border">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2 text-sm" data-testid="passkey-row">
              <KeyRound className="size-5 shrink-0 text-accent" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.label ?? t('security.unnamed')}</div>
                <div className="text-xs text-muted">
                  {t('security.created', { date: fmt(p.createdAt.slice(0, 10)) })} · {p.lastUsedAt ? t('security.lastUsed', { date: fmt(p.lastUsedAt.slice(0, 10)) }) : t('security.neverUsed')}
                </div>
              </div>
              <IconButton label={t('security.remove')} disabled={list.length <= 1 || remove.isPending} onClick={() => remove.mutate(p.id)}>
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
        {list.length === 1 && <p className="mt-1 text-xs text-muted">{t('security.onlyPasskey')}</p>}
        <Button variant="secondary" className="mt-2" busy={add.isPending} onClick={() => add.mutate(undefined)} data-testid="passkey-add">
          {t('security.addPasskey')}
        </Button>
      </Card>
      <Card>
        <CardTitle>{t('security.sessions')}</CardTitle>
        <ul className="divide-y divide-border" data-testid="sessions-list">
          {(ss.data?.sessions ?? []).slice(0, 5).map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
              <Smartphone className="size-5 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate" dir="ltr">
                  {s.device}
                </div>
                <div className="text-xs text-muted">{t('security.lastSeen', { date: fmt(s.lastSeenAt.slice(0, 10)) })}</div>
              </div>
              {s.current && <Badge tone="accent">{t('security.current')}</Badge>}
            </li>
          ))}
        </ul>
        {(ss.data?.sessions.length ?? 0) > 5 && <p className="mt-1 text-xs text-muted">{t('security.more', { count: (ss.data?.sessions.length ?? 0) - 5 })}</p>}
      </Card>
      <SessionCard />
    </>
  );
}
