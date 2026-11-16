import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, Smartphone, Trash2 } from 'lucide-react';
import { del, errorKey, get, patch, post } from '../../api';
import { Button, Card, CardTitle, Checkbox, Field, IconButton, Segmented, Select } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { useAccounts } from '../../lib/queries';
import { deviceState, enablePush, thisEndpoint, type DeviceState } from '../../lib/push';
import { ALL_WEEKDAYS, type Reminder, type ReminderInput, type RemindersResponse } from '../../../shared/reminders';

export const REMINDERS_QK = ['reminders'] as const;
export const useReminders = () => useQuery({ queryKey: REMINDERS_QK, queryFn: () => get<RemindersResponse>('/api/reminders') });

const time = (h: number) => `${String(h).padStart(2, '0')}:00`;
/** Weekday names, Sunday first (2026-11-15 is a Sunday). */
function useWeekdays(style: 'long' | 'short') {
  const { i18n } = useTranslation();
  const f = new Intl.DateTimeFormat(i18n.language, { weekday: style, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 10, 15 + i))));
}

function useDescribe() {
  const { t } = useTranslation();
  const long = useWeekdays('long');
  const short = useWeekdays('short');
  const accounts = new Map((useAccounts().data?.accounts ?? []).map((a) => [a.id, a.name]));
  return (r: Reminder) => {
    if (r.kind === 'review') return { title: t('settings.reminders.kindReview'), when: t('settings.reminders.reviewWhen') };
    if (r.kind === 'daily') {
      const days = r.weekdays === ALL_WEEKDAYS ? t('settings.reminders.everyDay') : short.filter((_, i) => (r.weekdays >> i) & 1).join(', ');
      return { title: t('settings.reminders.kindDaily'), when: t('settings.reminders.dailyWhen', { days, time: time(r.hour) }) };
    }
    const when = r.freq === 'weekly' ? t('settings.reminders.weeklyWhen', { day: long[r.day ?? 0], time: time(r.hour) }) : t('settings.reminders.monthlyWhen', { day: r.day, time: time(r.hour) });
    const acc = r.accountId ? accounts.get(r.accountId) : null;
    return { title: t('settings.reminders.kindImport'), when: acc ? `${when} · ${acc}` : when };
  };
}

/** This device's notification status, with the one action that moves it forward. */
function DeviceStatus({ data, state, onEnable }: { data: RemindersResponse; state: DeviceState | null; onEnable: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const test = useApiMutation(() => post<{ sent: number }>('/api/reminders/test'), { onSuccess: (r) => toast({ title: t(r.sent ? 'settings.reminders.testSent' : 'settings.reminders.testNone'), tone: r.sent ? 'good' : 'info' }) });
  if (!data.push.available) return <p className="text-sm text-muted" data-testid="push-unavailable">{t('settings.reminders.pushUnavailable')}</p>;
  if (!state) return null;
  return (
    <div className="flex flex-col gap-2" data-testid={`push-state-${state}`}>
      <p className="text-sm text-muted">{t(`settings.reminders.device.${state}`)}</p>
      {state === 'off' && (
        <Button variant="secondary" onClick={onEnable} data-testid="push-enable">
          <Bell className="size-4" aria-hidden />
          {t('settings.reminders.enablePush')}
        </Button>
      )}
      {state === 'on' && (
        <Button variant="secondary" busy={test.isPending} onClick={() => test.mutate(undefined)} data-testid="push-test">
          {t('settings.reminders.sendTest')}
        </Button>
      )}
    </div>
  );
}

function AddReminder({ hasReview, onSave, onAdded }: { hasReview: boolean; onSave: () => void; onAdded: () => void }) {
  const { t } = useTranslation();
  const long = useWeekdays('long');
  const short = useWeekdays('short');
  const accounts = (useAccounts().data?.accounts ?? []).filter((a) => !a.archived && a.type !== 'credit_card');
  const [kind, setKind] = useState<ReminderInput['kind']>('import');
  const [freq, setFreq] = useState<'weekly' | 'monthly'>('monthly');
  const [wday, setWday] = useState(0);
  const [mday, setMday] = useState(1);
  const [hour, setHour] = useState(9);
  const [dailyHour, setDailyHour] = useState(20);
  const [weekdays, setWeekdays] = useState(ALL_WEEKDAYS);
  const [accountId, setAccountId] = useState('');
  const add = useApiMutation(
    (b: ReminderInput) => post('/api/reminders', b),
    { invalidate: [REMINDERS_QK], successKey: 'settings.reminders.added', onSuccess: onAdded },
  );
  const submit = () => {
    onSave(); // permission prompt must start inside the click
    add.mutate(
      kind === 'import'
        ? { kind, freq, day: freq === 'weekly' ? wday : mday, hour, accountId: accountId || null }
        : kind === 'daily'
          ? { kind, hour: dailyHour, weekdays }
          : { kind },
    );
  };
  const hours = Array.from({ length: 24 }, (_, h) => (
    <option key={h} value={h}>
      {time(h)}
    </option>
  ));
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3" data-testid="reminder-add">
      <Field label={t('settings.reminders.kind')} htmlFor="rem-kind">
        <Select id="rem-kind" value={kind} onChange={(e) => setKind(e.target.value as ReminderInput['kind'])} data-testid="rem-kind">
          <option value="import">{t('settings.reminders.kindImport')}</option>
          <option value="daily">{t('settings.reminders.kindDaily')}</option>
          {!hasReview && <option value="review">{t('settings.reminders.kindReview')}</option>}
        </Select>
      </Field>
      {kind === 'import' && (
        <>
          <div>
            <Segmented<'weekly' | 'monthly'>
              label={t('settings.reminders.freq')}
              value={freq}
              onChange={setFreq}
              options={[
                { value: 'weekly', label: t('settings.reminders.weekly') },
                { value: 'monthly', label: t('settings.reminders.monthly') },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {freq === 'weekly' ? (
              <Field label={t('settings.reminders.weekday')} htmlFor="rem-wday">
                <Select id="rem-wday" value={wday} onChange={(e) => setWday(Number(e.target.value))} data-testid="rem-wday">
                  {long.map((n, i) => (
                    <option key={i} value={i}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label={t('settings.reminders.monthDay')} hint={mday > 28 ? t('settings.reminders.clampHint') : undefined} htmlFor="rem-mday">
                <Select id="rem-mday" value={mday} onChange={(e) => setMday(Number(e.target.value))} data-testid="rem-mday">
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t('settings.reminders.hour')} htmlFor="rem-hour">
              <Select id="rem-hour" value={hour} onChange={(e) => setHour(Number(e.target.value))} data-testid="rem-hour">
                {hours}
              </Select>
            </Field>
          </div>
          <Field label={t('settings.reminders.account')} htmlFor="rem-acc">
            <Select id="rem-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="rem-account">
              <option value="">{t('settings.reminders.anyAccount')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      {kind === 'daily' && (
        <>
          <Field label={t('settings.reminders.hour')} htmlFor="rem-dhour">
            <Select id="rem-dhour" value={dailyHour} onChange={(e) => setDailyHour(Number(e.target.value))} data-testid="rem-daily-hour">
              {hours}
            </Select>
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t('settings.reminders.days')}</legend>
            <div className="flex flex-wrap gap-1">
              {short.map((n, i) => {
                const on = ((weekdays >> i) & 1) === 1;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    disabled={on && weekdays === 1 << i}
                    onClick={() => setWeekdays(weekdays ^ (1 << i))}
                    className={`min-h-11 min-w-11 rounded-xl border px-2 text-sm ${on ? 'border-accent bg-accent/12 text-accent' : 'border-border text-muted'}`}
                    data-testid={`rem-day-${i}`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </>
      )}
      {kind === 'review' && <p className="text-sm text-muted">{t('settings.reminders.reviewHint')}</p>}
      <Button busy={add.isPending} onClick={submit} data-testid="rem-save">
        {t('settings.reminders.add')}
      </Button>
    </div>
  );
}

/** Settings → Reminders: per-user reminders plus this device's push status. */
export function RemindersCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useReminders();
  const describe = useDescribe();
  const [state, setState] = useState<DeviceState | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const data = q.data;
  const endpoints = (data?.devices ?? []).map((d) => d.endpoint).join('\n');
  useEffect(() => {
    if (!data?.push.available) return;
    void deviceState(endpoints.split('\n')).then(setState);
    void thisEndpoint().then(setMine);
  }, [data?.push.available, endpoints]);

  /** Permission is asked only from a click that turns a reminder on. */
  const ensurePush = async () => {
    if (!data?.push.publicKey || state !== 'off') return;
    try {
      setState(await enablePush(data.push.publicKey));
      await qc.invalidateQueries({ queryKey: REMINDERS_QK });
    } catch (e) {
      toast({ title: t(errorKey(e), { defaultValue: t('errors.unknown') }), tone: 'bad' });
    }
  };
  const toggle = useApiMutation((v: { id: string; enabled: boolean }) => patch(`/api/reminders/${v.id}`, { enabled: v.enabled }), { invalidate: [REMINDERS_QK] });
  const remove = useApiMutation((id: string) => del(`/api/reminders/${id}`), { invalidate: [REMINDERS_QK] });
  const removeDevice = useApiMutation((id: string) => del(`/api/reminders/devices/${id}`), { invalidate: [REMINDERS_QK] });
  if (!data) return null;
  const list = data.reminders;
  return (
    <Card data-testid="reminders-card">
      <CardTitle>{t('settings.reminders.title')}</CardTitle>
      <p className="mb-3 text-sm text-muted">{t('settings.reminders.hint')}</p>
      <DeviceStatus data={data} state={state} onEnable={() => void ensurePush()} />
      {data.devices.length > 0 && (
        <ul className="mt-2 divide-y divide-border" aria-label={t('settings.reminders.devices')}>
          {data.devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-1 text-sm" data-testid="push-device">
              <Smartphone className="size-5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {d.label ?? t('security.unnamed')}
                {d.endpoint === mine && <span className="text-muted"> · {t('settings.reminders.thisDevice')}</span>}
              </span>
              <IconButton label={t('security.remove')} onClick={() => removeDevice.mutate(d.id)}>
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 ? (
        <ul className="mt-3 divide-y divide-border" data-testid="reminder-list">
          {list.map((r) => {
            const d = describe(r);
            return (
              <li key={r.id} className="flex items-center gap-2 py-1" data-testid="reminder-row">
                <div className="min-w-0 flex-1">
                  <Checkbox
                    label={
                      <span className="flex flex-col">
                        <span className="font-medium">{d.title}</span>
                        <span className="text-xs text-muted">{d.when}</span>
                      </span>
                    }
                    checked={r.enabled}
                    onChange={(v) => {
                      toggle.mutate({ id: r.id, enabled: v });
                      if (v) void ensurePush();
                    }}
                    testId="reminder-toggle"
                  />
                </div>
                <IconButton label={t('settings.reminders.delete')} onClick={() => remove.mutate(r.id)} data-testid="reminder-delete">
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted" data-testid="reminders-empty">{t('settings.reminders.empty')}</p>
      )}
      {adding ? (
        <AddReminder
          hasReview={list.some((r) => r.kind === 'review')}
          onSave={() => void ensurePush()}
          onAdded={() => setAdding(false)}
        />
      ) : (
        list.length < 20 && (
          <Button variant="secondary" className="mt-3" onClick={() => setAdding(true)} data-testid="reminder-new">
            {t('settings.reminders.new')}
          </Button>
        )
      )}
    </Card>
  );
}
