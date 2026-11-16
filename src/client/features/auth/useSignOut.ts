import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { post } from '../../api';
import { unsubscribeThisDevice } from '../../lib/push';

export function useSignOut() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return async (all = false) => {
    await unsubscribeThisDevice();
    await post(all ? '/api/auth/logout-all' : '/api/auth/logout').catch(() => {});
    qc.clear();
    nav('/signin', { replace: true });
  };
}
