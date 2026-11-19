import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button, Card, CardTitle, IconButton, PageHeader, Segmented, Select } from '../../components/ui';
import { setLocale } from '../../i18n';
import { setTheme, storedTheme, type Theme } from '../../theme';
import type { Locale } from '../../../shared/money';
import { useNavTabs, useSavePrefs } from '../../lib/prefs';
import { PAGE_ITEMS } from '../../lib/nav';
import { AiSettings } from '../ai/AiSettings';
import { SecurityCard } from './Security';
import { RemindersCard } from './Reminders';
import { LiveCaptureCard } from './LiveCapture';
import { useCanWrite, useMe } from '../../lib/session';

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

/** Which pages fill the phone's bottom bar (per device). Picking a page already in another slot swaps them. */
function NavBarCard() {
  const { t } = useTranslation();
  const [tabs, setTabs] = useNavTabs();
  const put = (i: number, path: string) => {
    const next = [...tabs];
    const j = next.indexOf(path);
    if (j >= 0) next[j] = next[i]!;
    next[i] = path;
    setTabs(next);
  };
  return (
    <Card className="lg:hidden" data-testid="navbar-settings" data-tour="navbar">
      <CardTitle action={<Button variant="ghost" size="sm" onClick={() => setTabs(null)} data-testid="navbar-reset">{t('settings.navReset')}</Button>}>{t('settings.navBar')}</CardTitle>
      <p className="mb-3 text-sm text-muted">{t('settings.navBarHint')}</p>
      <ol className="flex flex-col gap-2">
        {tabs.map((p, i) => (
          <li key={i} className="flex items-center gap-1">
            <Select className="min-w-0 flex-1" aria-label={t('settings.navSlot', { n: i + 1 })} value={p} onChange={(e) => put(i, e.target.value)} data-testid={`navbar-slot-${i}`}>
              {PAGE_ITEMS.map((it) => (
                <option key={it.to} value={it.to}>
                  {t(it.key)}
                </option>
              ))}
            </Select>
            <IconButton label={t('settings.moveUp')} disabled={i === 0} onClick={() => put(i, tabs[i - 1]!)} className="disabled:opacity-30">
              <ChevronUp className="size-5" aria-hidden />
            </IconButton>
            <IconButton label={t('settings.moveDown')} disabled={i === tabs.length - 1} onClick={() => put(i, tabs[i + 1]!)} className="disabled:opacity-30">
              <ChevronDown className="size-5" aria-hidden />
            </IconButton>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function Component() {
  const { t } = useTranslation();
  const me = useMe();
  const canWrite = useCanWrite();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('settings.title')} />
      <AppearanceCard />
      <NavBarCard />
      {me?.active && <RemindersCard />}
      {me?.active && canWrite && <LiveCaptureCard />}
      {me?.active && <AiSettings />}
      <SecurityCard />
    </div>
  );
}
