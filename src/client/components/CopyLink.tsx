import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Share2 } from 'lucide-react';
import { Button } from './ui';

/** Shows a secret link once, with Copy and the native share sheet. */
export function CopyLink({ link, label, testId = 'invite-link' }: { link: string; label: string; testId?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <span className="text-sm font-medium">{label}</span>
      <code dir="ltr" className="block break-all rounded-lg bg-surface p-2 text-xs" data-testid={testId}>
        {link}
      </code>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
        {canShare && (
          <Button size="sm" variant="secondary" onClick={() => void navigator.share({ url: link }).catch(() => {})}>
            <Share2 className="size-4" aria-hidden />
            {t('common.share')}
          </Button>
        )}
      </div>
    </div>
  );
}
