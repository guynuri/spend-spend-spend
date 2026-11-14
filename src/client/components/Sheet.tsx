import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './ui';

/** Bottom sheet on phones, centered dialog from 768 px (PLAN §13). */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  testId,
  wide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-[fade-in_150ms]" />
        <Dialog.Content
          data-testid={testId}
          aria-describedby={description ? undefined : undefined}
          className={cx(
            'fixed z-50 flex max-h-[92dvh] flex-col bg-surface text-text shadow-xl focus:outline-none',
            'inset-x-0 bottom-0 rounded-t-3xl pb-[env(safe-area-inset-bottom)]',
            'md:inset-x-auto md:bottom-auto md:start-1/2 md:top-1/2 md:w-full md:-translate-y-1/2 md:rounded-2xl md:pb-0 ltr:md:-translate-x-1/2 rtl:md:translate-x-1/2',
            wide ? 'md:max-w-3xl' : 'md:max-w-lg',
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border md:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-2 px-4 pt-3">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              {description ? <Dialog.Description className="text-sm text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="-me-2 inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2" aria-label={t('common.close')}>
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
