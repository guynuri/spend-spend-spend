import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorKey } from '../api';
import { useToast } from '../components/Toast';

/** useMutation that invalidates keys on success and toasts translated errors. */
export function useApiMutation<TVars, TRes>(fn: (v: TVars) => Promise<TRes>, opts: { invalidate?: QueryKey[]; onSuccess?: (r: TRes, v: TVars) => void; successKey?: string } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      if (opts.successKey) toast({ title: t(opts.successKey), tone: 'good' });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast({ title: t(errorKey(e), { defaultValue: t('errors.unknown') }), tone: 'bad' }),
  });
}
