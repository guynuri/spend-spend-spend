import { useCallback, useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorKey } from '../api';
import { useToast } from '../components/Toast';

/**
 * useMutation that invalidates keys on success and toasts translated errors. `isPendingWith(match)`
 * tells whether any call still in flight matches (e.g. the row whose button was tapped): unlike
 * `variables`, which holds only the latest call, it covers several rows saving at once.
 */
export function useApiMutation<TVars, TRes>(fn: (v: TVars) => Promise<TRes>, opts: { invalidate?: QueryKey[]; onSuccess?: (r: TRes, v: TVars) => void; successKey?: string } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const [inFlight, setInFlight] = useState<TVars[]>([]);
  const m = useMutation({
    mutationFn: fn,
    // Tracked until settled, i.e. after the success handler has refreshed the data, so a row's
    // button can't be tapped again in between.
    onMutate: (v) => setInFlight((xs) => [...xs, v]),
    onSuccess: async (r, v) => {
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      if (opts.successKey) toast({ title: t(opts.successKey), tone: 'good' });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast({ title: t(errorKey(e), { defaultValue: t('errors.unknown') }), tone: 'bad' }),
    onSettled: (_r, _e, v) =>
      setInFlight((xs) => {
        const i = xs.indexOf(v);
        return i < 0 ? xs : [...xs.slice(0, i), ...xs.slice(i + 1)];
      }),
  });
  const isPendingWith = useCallback((match: (v: TVars) => boolean) => inFlight.some(match), [inFlight]);
  return Object.assign(m, { isPendingWith });
}
