import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardTitle, PageHeader, Segmented } from '../../components/ui';
import { setLocale } from '../../i18n';
import { setTheme, storedTheme, type Theme } from '../../theme';
import type { Locale } from '../../../shared/money';
import { useSavePrefs } from '../../lib/prefs';

export function AppearanceCard() {
  const { t, i18n } = useTranslation();
  const [theme, setThemeState] = useState<Theme>(storedTheme());
  const savePrefs = useSavePrefs();
  return (
    <Card>
      <CardTitle>{t('settings.appearance')}</CardTitle>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('locale.label')}</span>
          <div data-testid="locale-switch">
            <Segmented<Locale>
              label={t('locale.label')}
              value={i18n.language as Locale}
              onChange={(l) => {
                void setLocale(l);
                savePrefs({ locale: l });
              }}
              options={[
                { value: 'en', label: <span lang="en">{t('locale.en')}</span> },
                { value: 'he', label: <span lang="he">{t('locale.he')}</span> },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('theme.label')}</span>
          <div>
          <Segmented<Theme>
            label={t('theme.label')}
            value={theme}
            onChange={(v) => {
              setThemeState(v);
              setTheme(v);
              savePrefs({ theme: v });
            }}
            options={[
              { value: 'system', label: t('theme.system') },
              { value: 'light', label: t('theme.light') },
              { value: 'dark', label: t('theme.dark') },
            ]}
          />
          </div>
        </div>
      </div>
    </Card>
  );
}

export function Component() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('settings.title')} />
      <AppearanceCard />
    </div>
  );
}
