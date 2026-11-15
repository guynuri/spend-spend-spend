import * as RT from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './ui';

interface ToastItem {
  id: number;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'info' | 'good' | 'bad';
  action?: { label: ReactNode; onClick: () => void };
  duration?: number;
}
type ToastFn = (t: Omit<ToastItem, 'id'>) => void;
const Ctx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(Ctx);

let seq = 0;
export function ToastProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback<ToastFn>((t) => setItems((xs) => [...xs.slice(-2), { ...t, id: ++seq }]), []);
  return (
    <Ctx.Provider value={push}>
      <RT.Provider swipeDirection="down" duration={6000}>
        {children}
        {items.map((t) => (
          <RT.Root
            key={t.id}
            duration={t.duration ?? 6000}
            data-testid="toast"
            onOpenChange={(o) => !o && setItems((xs) => xs.filter((x) => x.id !== t.id))}
            className={cx(
              'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-lg',
              t.tone === 'bad' ? 'border-bad/40 bg-surface text-text' : 'border-border bg-text text-bg',
            )}
          >
            <div className="min-w-0 flex-1">
              <RT.Title className="font-medium">{t.title}</RT.Title>
              {t.description && <RT.Description className="opacity-80">{t.description}</RT.Description>}
            </div>
            {t.action && (
              <RT.Action altText="action" asChild>
                <button type="button" className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-accent" onClick={t.action.onClick} data-testid="toast-action">
                  {t.action.label}
                </button>
              </RT.Action>
            )}
          </RT.Root>
        ))}
        <RT.Viewport
          dir={i18n.dir()}
          className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] mx-auto flex w-full max-w-md flex-col gap-2 px-4 outline-none lg:bottom-6"
        />
      </RT.Provider>
    </Ctx.Provider>
  );
}
