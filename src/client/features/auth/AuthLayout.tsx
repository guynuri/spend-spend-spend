import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '../../components/ui';
import { setLocale } from '../../i18n';
import type { Locale } from '../../../shared/money';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col items-center bg-bg px-4 pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+2rem)] text-text" data-testid="auth-layout">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-between gap-2">
          <div>
            <div className="text-3xl font-bold text-accent">{t('app.name')}</div>
            <div className="text-sm text-muted">{t('app.tagline')}</div>
          </div>
          <div data-testid="locale-switch">
            <Segmented<Locale>
              label={t('locale.label')}
              value={i18n.language as Locale}
              onChange={(l) => void setLocale(l)}
              options={[
                { value: 'en', label: <span lang="en">EN</span> },
                { value: 'he', label: <span lang="he">עב</span> },
              ]}
            />
          </div>
        </div>
        <main className="rounded-2xl border border-border bg-surface p-5 shadow-sm">{children}</main>
      </div>
    </div>
  );
}
