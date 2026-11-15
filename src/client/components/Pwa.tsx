import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './ui';

const HINT_KEY = 'mz_hint_install';

function isIosSafariBrowser() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}

export function InstallHint() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(HINT_KEY) === '1';
    } catch {
      /* ignore */
    }
    setShow(!dismissed && isIosSafariBrowser());
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/8 p-4" data-testid="install-hint">
      <Share className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t('pwa.installTitle')}</p>
        <p className="text-sm text-muted">{t('pwa.installBody')}</p>
      </div>
      <button type="button" onClick={dismiss} className="-m-2 inline-flex size-11 items-center justify-center rounded-xl text-muted" aria-label={t('common.dismiss')}>
        <X className="size-5" aria-hidden />
      </button>
    </div>
  );
}

export function OfflineBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm" data-testid="offline-banner">
      <WifiOff className="size-4 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1">
        <span className="font-medium">{t('pwa.offlineTitle')}</span> <span className="text-muted">{t('pwa.offlineBody')}</span>
      </div>
      <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-text px-4 py-3 text-sm text-bg shadow-lg lg:bottom-6" data-testid="update-prompt">
      <span className="flex-1">{t('pwa.updateAvailable')}</span>
      <button type="button" className="min-h-11 rounded-lg px-3 font-semibold text-accent" onClick={() => void updateServiceWorker(true)}>
        {t('common.reload')}
      </button>
      <button type="button" className="min-h-11 rounded-lg px-2" onClick={() => setNeedRefresh(false)} aria-label={t('common.dismiss')}>
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
