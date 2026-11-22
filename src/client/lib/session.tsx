import { createContext, useContext, useMemo } from 'react';
import type { MeResponse } from '../../shared/schemas/me';
import { makeCal } from '../../shared/period';

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

/** The household's budget periods (pay day, D-R23). */
export const useCal = () => {
  const day = useMe()?.active?.periodStartDay ?? 1;
  return useMemo(() => makeCal(day), [day]);
};
/** Periods for statistics (Trends): the budget periods, or calendar months when the household chose them. */
export const useStatsCal = () => {
  const a = useMe()?.active;
  const day = a && a.statsByPeriod !== false ? (a.periodStartDay ?? 1) : 1;
  return useMemo(() => makeCal(day), [day]);
};
