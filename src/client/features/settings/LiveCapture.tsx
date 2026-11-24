/**
 * "Live card tracking" (D-R20): a personal add-only key and step-by-step iPhone Shortcuts setup for
 * Apple Pay purchases (Wallet "Transaction" automation) and for sharing bank / card files to the app.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, KeyRound, Trash2 } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { Button, Card, CardTitle, ErrorState, Field, IconButton, Input, Spinner } from '../../components/ui';
import { useApiMutation } from '../../lib/mutate';
import { useAccounts } from '../../lib/queries';
import { useRole } from '../../lib/session';

interface CaptureKey {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastResult: string | null;
  lastDetail: string | null;
}
const GOOD = new Set(['added', 'duplicate', 'test', 'skipped', 'imported']);

/** "Last attempt 24 Nov, 21:14 · a purchase was added ✓", and what arrived when it went wrong. */
function KeyStatus({ k }: { k: CaptureKey }) {
  const { t, i18n } = useTranslation();
  if (!k.lastUsedAt) return <span className="text-xs text-muted">{t('live.neverUsed')}</span>;
  const when = new Intl.DateTimeFormat(i18n.language === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(k.lastUsedAt));
  const code = k.lastResult;
  const ok = !code || GOOD.has(code);
  return (
    <span className="block text-xs text-muted" data-testid="live-key-status" data-result={code ?? ''}>
      {t('live.lastAttempt', { when })}
      {code && (
        <>
          {' · '}
          <span className={ok ? 'text-good' : 'font-medium text-bad'}>{t(`live.result.${code}`, { defaultValue: t('live.result.other', { code }) })}</span>
        </>
      )}
      {!ok && k.lastDetail && (
        <bdi className="block" dir="ltr">
          {t('live.received', { detail: k.lastDetail })}
        </bdi>
      )}
    </span>
  );
}
const QK = ['capture-keys'];
type Kind = 'purchase' | 'file';
const LINK = /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}\/?$/;

/** The household's shared shortcuts (iCloud links the owner published once). */
function useShortcutLinks() {
  return useQuery({ queryKey: ['household'], queryFn: () => get<{ shortcutLinks: Record<Kind, string | null> }>('/api/household') });
}

/**
 * Owner only: build the shortcut once (steps), then paste its iCloud link so everyone in the household
 * installs it with one tap. Shows the current link with a way to replace or remove it.
 */
function PublishLink({ kind, link }: { kind: Kind; link: string | null }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const save = useApiMutation((v: string | null) => patch('/api/household', { [kind === 'purchase' ? 'shortcutPurchaseLink' : 'shortcutFileLink']: v }), {
    invalidate: [['household']],
    successKey: 'ledger.saved',
    onSuccess: () => setValue(''),
  });
  const ok = LINK.test(value.trim());
  return (
    <details className="rounded-xl border border-border p-3" data-testid={`live-publish-${kind}`}>
      <summary className="min-h-11 cursor-pointer content-center font-medium">{t(link ? 'live.publish.change' : 'live.publish.title')}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-muted">{t('live.publish.body')}</p>
        <Steps section={kind === 'purchase' ? 'buildPurchase' : 'buildFile'} count={7} />
        <Field label={t('live.publish.label')} htmlFor={`live-link-${kind}`} error={value.trim() && !ok ? t('live.publish.invalid') : undefined}>
          <Input id={`live-link-${kind}`} dir="ltr" inputMode="url" placeholder={t('live.publish.placeholder')} value={value} onChange={(e) => setValue(e.target.value)} data-testid={`live-link-input-${kind}`} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!ok} busy={save.isPendingWith((v) => v !== null)} onClick={() => save.mutate(value.trim())} data-testid={`live-link-save-${kind}`}>
            {t('common.save')}
          </Button>
          {link && (
            <Button size="sm" variant="ghost" className="text-bad" busy={save.isPendingWith((v) => v === null)} onClick={() => save.mutate(null)} data-testid={`live-link-remove-${kind}`}>
              {t('live.publish.remove')}
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}

/**
 * One shortcut's setup: with a published link, install in one tap (it asks for the key) plus the few
 * phone-side steps Apple doesn't let any app do; the full manual steps stay one tap away. Without a link,
 * the manual steps (and, for the owner, how to publish one).
 */
function ShortcutSetup({ kind, link, keyShown, isOwner }: { kind: Kind; link: string | null; keyShown: string; isOwner: boolean }) {
  const { t } = useTranslation();
  const manual = <Steps section={kind === 'purchase' ? 'applePay' : 'share'} count={kind === 'purchase' ? 8 : 7} values={{ key: keyShown }} />;
  return (
    <div className="flex flex-col gap-3" data-testid={`live-setup-${kind}`}>
      {link ? (
        <>
          <div className="flex flex-col gap-2 rounded-xl bg-accent/5 p-3" data-testid={`live-quick-${kind}`}>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-medium text-accent-fg"
              data-testid={`live-install-${kind}`}
            >
              <Download className="size-4" aria-hidden />
              {t(kind === 'purchase' ? 'live.quick.installPurchase' : 'live.quick.installFile')}
            </a>
            <p>{t('live.quick.pasteKey')}</p>
            {kind === 'purchase' ? (
              <>
                <p className="font-medium">{t('live.quick.automationTitle')}</p>
                <Steps section="quickPurchase" count={5} />
                <p className="text-xs text-muted">{t('live.quick.testPurchase')}</p>
                <p className="text-xs text-muted" data-testid="live-trouble">{t('live.trouble')}</p>
              </>
            ) : (
              <p>{t('live.quick.useFile')}</p>
            )}
          </div>
          <details className="rounded-xl border border-border p-3" data-testid={`live-manual-${kind}`}>
            <summary className="min-h-11 cursor-pointer content-center font-medium">{t('live.quick.didntWork')}</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-muted">{t('live.quick.manualIntro')}</p>
              {manual}
            </div>
          </details>
        </>
      ) : (
        <>
          {!isOwner && <p className="text-xs text-muted">{t('live.quick.askOwner')}</p>}
          {manual}
        </>
      )}
      {isOwner && <PublishLink kind={kind} link={link} />}
    </div>
  );
}

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
  // only say the key is on the clipboard when it is (Safari refuses a write that isn't right after a tap)
  const [copied, setCopied] = useState(false);
  const create = useApiMutation(() => post<{ id: string; token: string }>('/api/capture-keys', { label: label.trim() || undefined }), {
    invalidate: [QK],
    onSuccess: (r) => {
      setFresh(r.token);
      setLabel('');
      setCopied(false);
      // ready to paste when the shortcut asks for it
      void navigator.clipboard?.writeText(r.token).then(() => setCopied(true), () => {});
    },
  });
  const revoke = useApiMutation((id: string) => del(`/api/capture-keys/${id}`), { invalidate: [QK] });
  const links = useShortcutLinks().data?.shortcutLinks ?? { purchase: null, file: null };
  const isOwner = useRole() === 'owner';
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
                      <KeyStatus k={k} />
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
              <p className="font-medium">{t(copied ? 'live.showOnceCopied' : 'live.showOnce')}</p>
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
          <ShortcutSetup kind="purchase" link={links.purchase} keyShown={keyShown} isOwner={isOwner} />
          <p className="text-xs text-muted">{t('live.applePayNote')}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('live.shareTitle')}</h3>
          <p className="text-muted">{t('live.shareBody')}</p>
          <CopyRow label={t('live.urlFile')} value={`${origin}/api/hook/file`} testId="live-url-file" />
          <ShortcutSetup kind="file" link={links.file} keyShown={keyShown} isOwner={isOwner} />
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
