import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { post } from '../../api';
import { Badge, Button } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useCanWrite, useIsOwner, useMe } from '../../lib/session';
import { useAiStatus } from '../ai/useAi';

export interface AiReview {
  headline: string;
  commentary: Record<string, string>;
  model?: string;
}

/** AC12.3 / AC13.4: AI button when enabled; owner hint when off; hidden for others; rule text on failure. */
export function AiReviewControls({ month, ai }: { month: string; status: 'draft' | 'completed'; ai: AiReview | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const owner = useIsOwner();
  const canWrite = useCanWrite();
  const s = useAiStatus();
  const [busy, setBusy] = useState(false);
  const enabled = !!s.data?.available && !!s.data?.enabled;
  return (
    <div className="flex flex-col gap-2" data-testid="ai-controls">
      {ai && (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="ai-written">
          <Badge tone="accent">
            <Sparkles className="size-3" aria-hidden />
            {t('ai.aiTag')}
          </Badge>
          <span className="text-muted">{t('ai.disclaimer')}</span>
        </div>
      )}
      {enabled && canWrite && (
        <Button
          variant="secondary"
          busy={busy}
          data-testid="ai-write"
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/api/ai/review/${month}`);
              await qc.invalidateQueries({ queryKey: ['review', month] });
              await qc.invalidateQueries({ queryKey: ['ai-status'] });
            } catch {
              toast({ title: t('ai.failed'), tone: 'bad' });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Sparkles className="size-4" aria-hidden />
          {busy ? t('ai.writing') : t('ai.writeReview')}
        </Button>
      )}
      {!enabled && owner && me && (
        <p className="text-sm text-muted" data-testid="ai-enable-hint">
          {t('ai.enableHint')}{' '}
          <Link to="/settings" className="font-medium text-accent">
            {t('ai.enableHintLink')}
          </Link>
        </p>
      )}
    </div>
  );
}
