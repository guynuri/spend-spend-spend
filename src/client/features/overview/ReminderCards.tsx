import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BellRing, X } from 'lucide-react';
import { post } from '../../api';
import { Card } from '../../components/ui';
import { useBankName } from '../../components/BankBadge';
import { useApiMutation } from '../../lib/mutate';
import { useAccounts } from '../../lib/queries';
import { bankUrl } from '../../../shared/banks';
import { REMINDERS_QK, useReminders } from '../settings/Reminders';

const btn = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 font-medium text-accent-fg';

/** In-app side of reminders: one dismissible card per reminder that came due since it was last seen. */
export function ReminderCards() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const q = useReminders();
  const accounts = new Map((useAccounts().data?.accounts ?? []).map((a) => [a.id, a]));
  const bankName = useBankName();
  const seen = useApiMutation((id: string) => post(`/api/reminders/${id}/seen`), { invalidate: [REMINDERS_QK] });
  const due = (q.data?.reminders ?? []).filter((r) => r.due && r.kind !== 'review'); // review: ReviewDueCard
  if (!due.length) return null;
  return (
    <>
      {due.map((r) => {
        const acc = r.accountId ? accounts.get(r.accountId) : undefined;
        const url = acc ? bankUrl(acc) : null;
        const importTo = acc ? `/import?account=${acc.id}` : '/import';
        const done = () => seen.mutate(r.id);
        return (
          <Card key={r.id} data-testid="reminder-card">
            <div className="flex items-start gap-3">
              <BellRing className="mt-0.5 size-6 shrink-0 text-accent" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div>
                  <p className="font-semibold">{t(r.kind === 'daily' ? 'settings.reminders.cardDaily' : 'settings.reminders.cardImport')}</p>
                  <p className="text-sm text-muted">{r.kind === 'daily' ? t('settings.reminders.cardDailyBody') : t('settings.reminders.cardImportBody')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.kind === 'daily' ? (
                    <Link to="/?add=1" onClick={done} className={btn} data-testid="reminder-card-open">
                      {t('settings.reminders.cardDailyOpen')}
                    </Link>
                  ) : url && acc ? (
                    // one click: the bank site in a new tab, the app moves to Import with the account picked
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        done();
                        void nav(importTo);
                      }}
                      className={btn}
                      data-testid="reminder-card-open"
                    >
                      {t('import.openBankNamed', { bank: bankName(acc) })}
                    </a>
                  ) : (
                    <Link to={importTo} onClick={done} className={btn} data-testid="reminder-card-open">
                      {t('settings.reminders.cardImportOpen')}
                    </Link>
                  )}
                </div>
              </div>
              <button type="button" onClick={done} className="-m-2 inline-flex size-11 items-center justify-center rounded-xl text-muted" aria-label={t('common.dismiss')} data-testid="reminder-card-dismiss">
                <X className="size-5" aria-hidden />
              </button>
            </div>
          </Card>
        );
      })}
    </>
  );
}
