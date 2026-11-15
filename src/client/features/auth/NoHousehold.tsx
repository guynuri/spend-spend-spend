import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '../../components/ui';
import { useMe } from '../../lib/session';
import { AuthLayout } from './AuthLayout';
import { useSignOut } from './useSignOut';

export function NoHousehold() {
  const { t } = useTranslation();
  const me = useMe();
  const signOut = useSignOut();
  return (
    <AuthLayout>
      <h1 className="mb-2 text-xl font-semibold">{t('auth.noHouseholdTitle')}</h1>
      <p className="mb-4 text-sm text-muted">{t('auth.noHouseholdBody')}</p>
      <div className="flex flex-col gap-2">
        {me?.user.isSuperAdmin && (
          <Link to="/admin" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 font-medium text-accent-fg">
            {t('nav.admin')}
          </Link>
        )}
        <Button variant="secondary" onClick={() => void signOut()}>
          {t('auth.signOut')}
        </Button>
      </div>
    </AuthLayout>
  );
}
