import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from './Sheet';
import { Button, Input } from './ui';
import { useToast } from './Toast';
import { errorKey } from '../api';

/** Explicit confirmation for destructive actions; optional typed confirmation. */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  typed,
  danger = true,
  testId = 'confirm',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => Promise<void> | void;
  typed?: string;
  danger?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  // Typed confirmations never carry over from a previous opening (Cancel, ✕, swipe or reuse for another action).
  useEffect(() => {
    if (open) setText('');
  }, [open, typed]);
  const close = () => {
    setText('');
    onOpenChange(false);
  };
  const ok = !typed || text.trim() === typed;
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : close())}
      title={title}
      testId={testId}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            busy={busy}
            disabled={!ok}
            data-testid={`${testId}-ok`}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                close();
              } catch (e) {
                toast({ title: t(errorKey(e), { defaultValue: t('errors.unknown') }), tone: 'bad' });
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <div className="text-sm text-muted">{body}</div>}
      {typed && <Input className="mt-3" value={text} onChange={(e) => setText(e.target.value)} data-testid={`${testId}-input`} aria-label={typed} />}
    </Sheet>
  );
}
