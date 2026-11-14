import { useTranslation } from 'react-i18next';
import { intlLocale, type Locale } from '../../shared/money';

const opts: Record<string, Intl.DateTimeFormatOptions> = {
  short: { day: '2-digit', month: '2-digit', year: 'numeric' },
  dayMonth: { day: 'numeric', month: 'short' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  weekday: { weekday: 'long', day: 'numeric', month: 'long' },
  month: { month: 'long', year: 'numeric' },
  monthShort: { month: 'short' },
  monthShortYear: { month: 'short', year: '2-digit' },
};
export type DateFormat = keyof typeof opts;

export function formatDate(date: string, format: DateFormat, locale: Locale): string {
  const d = date.length === 7 ? `${date}-01` : date;
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(intlLocale(locale), { ...opts[format], timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, day)));
}

/** The only way to print a date or month (PLAN §12). */
export function DateText({ date, format = 'short', className }: { date: string | null | undefined; format?: DateFormat; className?: string }) {
  const { i18n } = useTranslation();
  if (!date) return <bdi className={className}>—</bdi>;
  return (
    <bdi className={className}>
      <time dateTime={date}>{formatDate(date, format, i18n.language as Locale)}</time>
    </bdi>
  );
}

export function useFormatDate() {
  const { i18n } = useTranslation();
  return (date: string, format: DateFormat = 'short') => formatDate(date, format, i18n.language as Locale);
}
