import { forwardRef, useContext, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { TOUR_PATHS, TourCtx } from '../lib/tour';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-2 text-text border border-border hover:bg-border/50 active:bg-border',
  ghost: 'bg-transparent text-text hover:bg-surface-2 active:bg-border/60',
  danger: 'bg-bad text-white hover:brightness-110 active:brightness-95',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; size?: 'md' | 'sm' }>(
  function Button({ variant = 'primary', busy, size = 'md', className, children, disabled, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || busy}
        className={cx(
          'inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition disabled:opacity-50',
          size === 'md' ? 'min-h-11 px-4 text-base' : 'min-h-9 px-3 text-sm',
          variants[variant],
          className,
        )}
        {...rest}
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 active:bg-border/60', className)} {...rest}>
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cx('rounded-2xl border border-border bg-surface p-4 shadow-sm', className)} {...rest}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-text">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, actions, subtitle }: { title: ReactNode; actions?: ReactNode; subtitle?: ReactNode }) {
  const openTour = useContext(TourCtx);
  const { pathname } = useLocation();
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <h1 className="truncate text-2xl font-bold text-text">{title}</h1>
          {openTour && TOUR_PATHS.has(pathname) && (
            <IconButton label={t('tour.pageInfo')} className="size-9 shrink-0" data-testid="page-tour" onClick={() => openTour(pathname)}>
              <Info className="size-5" aria-hidden />
            </IconButton>
          )}
        </div>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-text">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls = 'min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputCls, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cx(inputCls, 'pe-8', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputCls, 'min-h-20 py-2', className)} {...rest} />;
});

export function Checkbox({ label, checked, onChange, testId }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-text">
      <input type="checkbox" className="size-5 accent-[var(--mz-accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>{label}</span>
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" className={cx('flex items-center justify-center gap-2 p-6 text-muted', className)}>
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{t('common.loading')}</span>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-6 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-medium text-text">{title}</p>
      {body && <p className="max-w-prose text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'accent';
const toneCls: Record<Tone, string> = {
  good: 'bg-good/12 text-good',
  warn: 'bg-warn/12 text-warn',
  bad: 'bg-bad/12 text-bad',
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent/12 text-accent',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', toneCls[tone], className)}>{children}</span>;
}

/** Horizontal bar; fills from the inline start (right in RTL). */
export function ProgressBar({ value, tone = 'accent', label, marker }: { value: number; tone?: Tone; label?: string; marker?: number }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1)) * 100;
  const bar: Record<Tone, string> = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', neutral: 'bg-muted', accent: 'bg-accent' };
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <div className={cx('h-full rounded-full transition-[width]', bar[tone])} style={{ width: `${pct}%` }} />
      {marker !== undefined && <div className="absolute top-0 h-full w-0.5 bg-text/60" style={{ insetInlineStart: `${Math.max(0, Math.min(1, marker)) * 100}%` }} />}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const code = (error as { code?: string })?.code;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-bad/30 bg-bad/5 p-6 text-center">
      <p className="text-sm text-text">{t(code ? `errors.${code}` : 'errors.unknown', { defaultValue: t('errors.unknown') })}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-border bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-9 rounded-lg px-3 text-sm font-medium', value === o.value ? 'bg-surface text-text shadow-sm' : 'text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
