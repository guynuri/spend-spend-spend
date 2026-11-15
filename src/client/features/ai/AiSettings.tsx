import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Sparkles, X } from 'lucide-react';
import { post } from '../../api';
import { Badge, Button, Card, CardTitle, Spinner } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { useFormatDate } from '../../components/DateText';
import { useApiMutation } from '../../lib/mutate';
import { useIsOwner } from '../../lib/session';
import { useAiStatus } from './useAi';

const KEYS = [['ai-status'], ['me'], ['review']];
const SENT = ['sent1', 'sent2', 'sent3', 'sent4'];
const NOT_SENT = ['notSent1', 'notSent2', 'notSent3', 'notSent4'];

/** Owner opt-in through a consent sheet naming provider, model, data sent, training, limits (AC13.1). */
export function AiSettings() {
  const { t } = useTranslation();
  const fmt = useFormatDate();
  const owner = useIsOwner();
  const q = useAiStatus();
  const [open, setOpen] = useState(false);
  const consent = useApiMutation((enabled: boolean) => post('/api/ai/consent', { enabled }), { invalidate: KEYS, onSuccess: () => setOpen(false) });
  if (q.isPending) return <Spinner />;
  const s = q.data;
  if (!s) return null;
  return (
    <Card data-testid="ai-settings">
      <CardTitle action={<Badge tone={s.enabled ? 'good' : 'neutral'}>{t(s.enabled ? 'ai.on' : 'ai.off')}</Badge>}>
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-5 text-accent" aria-hidden />
          {t('ai.title')}
        </span>
      </CardTitle>
      {!s.available ? (
        <p className="text-sm text-muted">{t('ai.unavailable')}</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">{t('ai.offBody')}</p>
          {s.enabled && (
            <>
              <p>
                {s.label} · <bdi>{s.model}</bdi>
                {s.consentAt && <span className="text-muted"> · {t('ai.consentedOn', { date: fmt(s.consentAt.slice(0, 10)) })}</span>}
              </p>
              <p className="text-muted">{t('ai.usage', { categorize: s.usageToday.categorize, cLimit: s.limits.categorize, review: s.usageToday.review, rLimit: s.limits.review })}</p>
            </>
          )}
          {owner ? (
            s.enabled ? (
              <Button variant="secondary" busy={consent.isPending} onClick={() => consent.mutate(false)} data-testid="ai-disable">
                {t('ai.disable')}
              </Button>
            ) : (
              <Button onClick={() => setOpen(true)} data-testid="ai-enable">
                {t('ai.enable')}
              </Button>
            )
          ) : (
            !s.enabled && <p className="text-muted">{t('ai.onlyOwner')}</p>
          )}
        </div>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('ai.consentTitle')}
        testId="ai-consent"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button busy={consent.isPending} onClick={() => consent.mutate(true)} data-testid="ai-consent-ok">
              {t('ai.agree')}
            </Button>
          </>
        }
      >
        <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">{t('ai.provider')}</dt>
          <dd data-testid="ai-consent-provider">{s.label}</dd>
          <dt className="text-muted">{t('ai.model')}</dt>
          <dd data-testid="ai-consent-model">
            <bdi>{s.model}</bdi>
          </dd>
        </dl>
        <p className="mb-1 text-sm font-medium">{t('ai.trains')}</p>
        <p className="mb-3 text-sm" data-testid="ai-consent-trains">
          {t(s.trainsOnInputs ? 'ai.trainsYes' : 'ai.trainsNo')}
        </p>
        <h3 className="text-sm font-semibold">{t('ai.sentTitle')}</h3>
        <ul className="mb-3 mt-1 flex flex-col gap-1 text-sm" data-testid="ai-consent-sent">
          {SENT.map((k) => (
            <li key={k} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              {t(`ai.${k}`)}
            </li>
          ))}
        </ul>
        <h3 className="text-sm font-semibold">{t('ai.notSentTitle')}</h3>
        <ul className="mb-3 mt-1 flex flex-col gap-1 text-sm">
          {NOT_SENT.map((k) => (
            <li key={k} className="flex gap-2">
              <X className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
              {t(`ai.${k}`)}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted" data-testid="ai-consent-limits">
          {t('ai.limits', { categorize: s.limits.categorize, review: s.limits.review })}
        </p>
      </Sheet>
    </Card>
  );
}
