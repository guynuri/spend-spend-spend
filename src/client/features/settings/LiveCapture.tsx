/**
 * "Live card tracking" (D-R20): a personal add-only key and step-by-step iPhone Shortcuts setup for
 * Apple Pay purchases (Wallet "Transaction" automation) and for sharing bank / card files to the app.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';
import { del, get, post } from '../../api';
import { Button, Card, CardTitle, ErrorState, Field, IconButton, Input, Spinner } from '../../components/ui';
import { DateText } from '../../components/DateText';
import { useApiMutation } from '../../lib/mutate';
import { useAccounts } from '../../lib/queries';

interface CaptureKey {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}
const QK = ['capture-keys'];

function CopyRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 p-2 text-xs" data-testid={testId}>
          {value}
        </code>
        <IconButton
          label={copied ? t('common.copied') : t('common.copy')}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </IconButton>
      </div>
    </div>
  );
}

/** One numbered step list; `items` are catalog keys under live.<section>. */
function Steps({ section, count, values = {} }: { section: string; count: number; values?: Record<string, string> }) {
  const { t } = useTranslation();
  return (
    <ol className="list-decimal space-y-1.5 ps-5 text-sm [overflow-wrap:anywhere]">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>{t(`live.${section}.s${i + 1}`, values)}</li>
      ))}
    </ol>
  );
}

export function LiveCaptureCard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: QK, queryFn: () => get<{ keys: CaptureKey[] }>('/api/capture-keys') });
  const cards = (useAccounts().data?.accounts ?? []).filter((a) => a.type === 'credit_card' && !a.archived);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const create = useApiMutation(() => post<{ id: string; token: string }>('/api/capture-keys', { label: label.trim() || undefined }), {
    invalidate: [QK],
    onSuccess: (r) => {
      setFresh(r.token);
      setLabel('');
    },
  });
  const revoke = useApiMutation((id: string) => del(`/api/capture-keys/${id}`), { invalidate: [QK] });
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const keyShown = fresh ?? t('live.yourKey');
  return (
    <Card data-testid="live-capture">
      <CardTitle>{t('live.title')}</CardTitle>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">{t('live.intro')}</p>
        {cards.length === 0 && (
          <p className="rounded-xl bg-warn/10 p-3 text-warn" data-testid="live-no-cards">
            {t('live.noCards')}{' '}
            <Link to="/accounts" className="font-semibold underline">
              {t('live.addCard')}
            </Link>
          </p>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('live.keyTitle')}</h3>
          <p className="text-muted">{t('live.keyBody')}</p>
          {q.isPending ? (
            <Spinner />
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            q.data.keys.length > 0 && (
              <ul className="divide-y divide-border rounded-xl border border-border" data-testid="live-keys">
                {q.data.keys.map((k) => (
                  <li key={k.id} className="flex items-center gap-2 px-3 py-2">
                    <KeyRound className="size-4 shrink-0 text-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <bdi className="block truncate font-medium">{k.label ?? t('live.unnamed')}</bdi>
                      <span className="text-xs text-muted">
                        {k.lastUsedAt ? (
                          <>
                            {t('live.lastUsed')} <DateText date={k.lastUsedAt.slice(0, 10)} />
                          </>
                        ) : (
                          t('live.neverUsed')
                        )}
                      </span>
                    </div>
                    <IconButton label={t('live.revoke')} disabled={revoke.isPendingWith((v) => v === k.id)} onClick={() => revoke.mutate(k.id)} data-testid="live-revoke">
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )
          )}
          {fresh ? (
            <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3" data-testid="live-fresh">
              <p className="font-medium">{t('live.showOnce')}</p>
              <CopyRow label={t('live.key')} value={fresh} testId="live-token" />
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={t('live.keyLabel')} htmlFor="live-label">
                  <Input id="live-label" dir="auto" maxLength={60} value={label} placeholder={t('live.keyLabelPlaceholder')} onChange={(e) => setLabel(e.target.value)} />
                </Field>
              </div>
              <Button busy={create.isPending} onClick={() => create.mutate(undefined)} data-testid="live-create">
                {t('live.create')}
              </Button>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('live.applePayTitle')}</h3>
          <p className="text-muted">{t('live.applePayBody')}</p>
          <CopyRow label={t('live.urlPurchase')} value={`${origin}/api/hook/purchase`} testId="live-url-purchase" />
          <Steps section="applePay" count={8} values={{ key: keyShown }} />
          <p className="text-xs text-muted">{t('live.applePayNote')}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('live.shareTitle')}</h3>
          <p className="text-muted">{t('live.shareBody')}</p>
          <CopyRow label={t('live.urlFile')} value={`${origin}/api/hook/file`} testId="live-url-file" />
          <Steps section="share" count={7} values={{ key: keyShown }} />
          <p className="text-xs text-muted">{t('live.sharePrivacy')}</p>
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="font-semibold">{t('live.monthlyTitle')}</h3>
          <p className="text-muted">{t('live.monthlyBody')}</p>
        </section>
      </div>
    </Card>
  );
}
