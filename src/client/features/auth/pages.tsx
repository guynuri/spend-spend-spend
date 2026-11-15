import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { KeyRound, Smartphone } from 'lucide-react';
import { ApiError, errorKey, get, post } from '../../api';
import { Button, Field, Input, Spinner } from '../../components/ui';
import { fragmentToken, registerWithToken, signInWithPasskey } from '../../lib/passkey';
import { AuthLayout } from './AuthLayout';
import type { MeResponse } from '../../../shared/schemas/me';

function ErrorLine({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 rounded-xl bg-bad/10 p-3 text-sm text-bad" data-testid="auth-error">
      {t(errorKey(error), { defaultValue: t('errors.unknown') })}
    </p>
  );
}

function IosNote() {
  const { t } = useTranslation();
  return (
    <p className="mt-4 flex gap-2 text-xs text-muted">
      <Smartphone className="size-4 shrink-0" aria-hidden />
      <span>{t('auth.iosNote')}</span>
    </p>
  );
}

function useAfterAuth() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return async (to = '/') => {
    // The link is spent: keep the cached inspection (staleTime ∞) so it is never re-inspected —
    // a failed inspect counts against the token rate limit. Only the profile is refreshed.
    await qc.invalidateQueries({ queryKey: ['me'] });
    nav(to, { replace: true });
  };
}

export function SignInPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const done = useAfterAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return (
    <AuthLayout>
      <h1 className="mb-2 text-xl font-semibold">{t('auth.signInTitle')}</h1>
      <p className="mb-5 text-sm text-muted">{t('auth.signInBody')}</p>
      <Button
        className="w-full"
        busy={busy}
        data-testid="signin-button"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await signInWithPasskey();
            await done(safeNext);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <KeyRound className="size-5" aria-hidden />
        {t('auth.signIn')}
      </Button>
      <ErrorLine error={error} />
      <IosNote />
    </AuthLayout>
  );
}

function RegisterForm({ token, kind, householdName, role }: { token: string; kind: 'bootstrap' | 'owner' | 'member' | 'recovery'; householdName?: string | null; role?: string | null }) {
  const { t } = useTranslation();
  const done = useAfterAuth();
  const [name, setName] = useState('');
  const [hh, setHh] = useState(() => t('auth.householdNameDefault'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const needsName = kind !== 'recovery';
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerWithToken(token, needsName ? name.trim() : undefined, kind === 'bootstrap' ? hh.trim() : undefined);
      history.replaceState(null, '', window.location.pathname);
      await done('/');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {kind === 'bootstrap' && <p className="text-sm text-muted">{t('auth.setupBody')}</p>}
      {(kind === 'owner' || kind === 'member') && <p className="text-sm text-muted">{t('auth.inviteBody', { household: householdName ?? '', role: t(`roles.${role ?? 'member'}`) })}</p>}
      {kind === 'recovery' && <p className="text-sm text-muted">{t('auth.recoverBody')}</p>}
      {needsName && (
        <Field label={t('auth.displayName')} htmlFor="displayName">
          <Input id="displayName" data-testid="display-name" autoComplete="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      {kind === 'bootstrap' && (
        <Field label={t('auth.householdName')} htmlFor="hhName">
          <Input id="hhName" data-testid="household-name-input" required maxLength={60} value={hh} onChange={(e) => setHh(e.target.value)} />
        </Field>
      )}
      <Button type="submit" busy={busy} disabled={needsName && !name.trim()} data-testid="create-passkey">
        <KeyRound className="size-5" aria-hidden />
        {t('auth.createPasskey')}
      </Button>
      <ErrorLine error={error} />
      <IosNote />
    </form>
  );
}

function useInspect(token: string) {
  return useQuery({
    queryKey: ['inspect', token],
    queryFn: () => post<{ kind: 'bootstrap' | 'owner' | 'member' | 'recovery'; householdName?: string | null; role?: string | null }>('/api/invites/inspect', { token }),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });
}

function TokenPage({ titleKey, expect }: { titleKey: string; expect: ('bootstrap' | 'owner' | 'member' | 'recovery')[] }) {
  const { t } = useTranslation();
  const [token] = useState(fragmentToken);
  const q = useInspect(token);
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<MeResponse>('/api/me'), retry: false, enabled: expect.includes('member') });
  const done = useAfterAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    document.title = t(titleKey, { app: t('app.name') });
  }, [t, titleKey]);
  let content;
  if (!token) content = <p className="text-sm text-muted">{t('auth.noLink')}</p>;
  else if (q.isPending || (expect.includes('member') && me.isPending)) content = <Spinner />;
  else if (q.error || !q.data || !expect.includes(q.data.kind))
    content = (
      <p className="text-sm text-bad" data-testid="link-invalid">
        {q.error instanceof ApiError && q.error.code === 'rate_limited' ? t('errors.rate_limited') : t('auth.linkInvalid')}
      </p>
    );
  else if (me.data && (q.data.kind === 'member' || q.data.kind === 'owner'))
    content = (
      <div className="flex flex-col gap-4">
        <p className="text-sm">{t('auth.inviteSignedIn', { name: me.data.user.displayName })}</p>
        <p className="text-sm text-muted">{t('auth.inviteBody', { household: q.data.householdName ?? '', role: t(`roles.${q.data.role ?? 'member'}`) })}</p>
        <Button
          busy={busy}
          data-testid="accept-invite"
          onClick={async () => {
            setBusy(true);
            try {
              await post('/api/invites/accept', { token });
              history.replaceState(null, '', window.location.pathname);
              await done('/');
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('auth.inviteAccept')}
        </Button>
        <ErrorLine error={error} />
      </div>
    );
  else content = <RegisterForm token={token} kind={q.data.kind} householdName={q.data.householdName} role={q.data.role} />;
  return (
    <AuthLayout>
      <h1 className="mb-3 text-xl font-semibold">{t(titleKey, { app: t('app.name') })}</h1>
      {content}
    </AuthLayout>
  );
}

export const SetupPage = () => <TokenPage titleKey="auth.setupTitle" expect={['bootstrap']} />;
export const InvitePage = () => <TokenPage titleKey="auth.inviteTitle" expect={['owner', 'member']} />;
export const RecoverPage = () => <TokenPage titleKey="auth.recoverTitle" expect={['recovery']} />;
