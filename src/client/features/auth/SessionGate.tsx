import { Outlet } from 'react-router';
import { SessionCtx } from '../../lib/session';

/** M1: no auth yet. M2 replaces this with the /api/me gate. */
export function SessionGate() {
  return (
    <SessionCtx.Provider value={null}>
      <Outlet />
    </SessionCtx.Provider>
  );
}
