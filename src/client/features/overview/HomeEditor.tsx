import { useTranslation } from 'react-i18next';
import { Bell, CalendarClock, ChartColumn, ChartLine, ChartPie, Check, CircleMinus, CirclePlus, Handshake, HeartPulse, PiggyBank, ReceiptText, RotateCcw, Target, Users, Wallet, type LucideIcon } from 'lucide-react';
import { Button, Card, CardTitle } from '../../components/ui';
import { SortableList } from '../../components/SortableList';
import { hiddenWidgets, moveItem, type HomeWidgetId } from '../../../shared/home';

export const WIDGET_ICON: Record<HomeWidgetId, LucideIcon> = {
  hero: Wallet,
  owed: Handshake,
  donut: ChartPie,
  who: Users,
  attention: Bell,
  upcoming: CalendarClock,
  forecast: ChartLine,
  goals: Target,
  health: HeartPulse,
  usual: ChartColumn,
  budgets: PiggyBank,
  recent: ReceiptText,
};

function WidgetLabel({ id }: { id: HomeWidgetId }) {
  const { t } = useTranslation();
  const Icon = WIDGET_ICON[id];
  return (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent" aria-hidden>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{t(`home.widgets.${id}.title`)}</span>
        <span className="block text-xs text-muted">{t(`home.widgets.${id}.body`)}</span>
      </span>
    </>
  );
}

/**
 * Customize Home: the widgets on Home in order (drag the grip, or arrow keys on it; − removes one) and
 * the ones that aren't (+ adds one at the end). Every change is saved straight away.
 */
export function HomeEditor({ shown, onChange, onReset, onDone, isDefault }: { shown: HomeWidgetId[]; onChange: (next: HomeWidgetId[]) => void; onReset: () => void; onDone: () => void; isDefault: boolean }) {
  const { t } = useTranslation();
  const hidden = hiddenWidgets(shown);
  return (
    <div className="flex flex-col gap-4" data-testid="home-editor">
      <Card>
        <CardTitle>{t('home.edit.onHome')}</CardTitle>
        <p className="mb-3 text-sm text-muted">{t('home.edit.intro')}</p>
        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">{t('home.edit.emptyList')}</p>
        ) : (
          <SortableList
            ids={shown}
            label={(id) => t(`home.widgets.${id}.title`)}
            onMove={(from, to) => onChange(moveItem(shown, from, to))}
            testId="home-edit-shown"
            render={(id, grip) => (
              <div className="flex min-h-14 items-center gap-2 rounded-2xl border border-border/70 bg-surface py-1 pe-1" data-testid="home-edit-row" data-widget={id}>
                {grip}
                <WidgetLabel id={id} />
                <button
                  type="button"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-bad hover:bg-bad/10"
                  aria-label={t('home.edit.remove', { name: t(`home.widgets.${id}.title`) })}
                  onClick={() => onChange(shown.filter((x) => x !== id))}
                  data-testid="home-edit-remove"
                >
                  <CircleMinus className="size-5" aria-hidden />
                </button>
              </div>
            )}
          />
        )}
      </Card>
      <Card>
        <CardTitle>{t('home.edit.more')}</CardTitle>
        {hidden.length === 0 ? (
          <p className="text-sm text-muted">{t('home.edit.allShown')}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="home-edit-hidden">
            {hidden.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-2 rounded-2xl border border-dashed border-border px-2 py-1 text-start hover:bg-surface-2"
                  onClick={() => onChange([...shown, id])}
                  aria-label={t('home.edit.add', { name: t(`home.widgets.${id}.title`) })}
                  data-testid="home-edit-add"
                  data-widget={id}
                >
                  <WidgetLabel id={id} />
                  <CirclePlus className="size-5 shrink-0 text-accent" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onReset} disabled={isDefault} data-testid="home-edit-reset">
          <RotateCcw className="size-4" aria-hidden />
          {t('home.edit.reset')}
        </Button>
        <Button onClick={onDone} data-testid="home-edit-done">
          <Check className="size-5" aria-hidden />
          {t('home.edit.done')}
        </Button>
      </div>
    </div>
  );
}
