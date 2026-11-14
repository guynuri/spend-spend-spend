import { createContext, useContext } from 'react';
import type { MeResponse } from '../../shared/schemas/me';

export const SessionCtx = createContext<MeResponse | null>(null);
export const useMe = () => useContext(SessionCtx);
export const useCurrency = () => useMe()?.active?.currency ?? 'ILS';
export const useRole = () => useMe()?.role ?? null;
/** True when the user may write tenant data (owner or member). */
export const useCanWrite = () => {
  const r = useRole();
  return r === 'owner' || r === 'member';
};
export const useIsOwner = () => useRole() === 'owner';
