import { useTranslation } from 'react-i18next';
import { Card, CardTitle, PageHeader } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { ForecastCard, useForecast } from './ForecastCard';
import { PlannedList } from '../recurring/Planned';

export function Component() {
  const { t } = useTranslation();
  const q = useForecast();
  const f = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('forecast.title')} />
      <ForecastCard link={false} />
      {f && f.missed.length > 0 && (
        <Card>
          <CardTitle>{t('forecast.missed')}</CardTitle>
          <ul className="divide-y divide-border text-sm" data-testid="forecast-missed">
            {f.missed.map((m) => (
              <li key={`${m.itemId}${m.due}`} className="flex justify-between gap-2 py-2">
                <span>
                  <bdi>{m.label}</bdi> · <DateText date={m.due} format="dayMonth" />
                </span>
                <Money minor={m.amountMinor} tone />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {f && f.overdue.length > 0 && (
        <Card>
          <CardTitle>{t('forecast.overdue')}</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {f.overdue.map((m) => (
              <li key={m.plannedId} className="flex justify-between gap-2 py-2">
                <span>
                  <bdi>{m.label}</bdi> · <DateText date={m.date} format="dayMonth" />
                </span>
                <Money minor={m.amountMinor} tone />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <PlannedList />
    </div>
  );
}
