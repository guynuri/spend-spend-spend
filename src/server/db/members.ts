/**
 * Membership / invite operations scoped to ONE household (the session's). Used by
 * routes/household.ts so that route never touches global tables directly.
 */
import type { Role } from '../../shared/schemas/me';
import { globalDb } from './global';

export function householdMembers(db: D1Database, householdId: string) {
  const g = globalDb(db);
  return {
    list: () => g.members(householdId),
    countOwners: () => g.countOwners(householdId),
    roleOf: async (userId: string) => (await g.membership(householdId, userId))?.role ?? null,
    setRole: (userId: string, role: Role) => g.setRole(householdId, userId, role).run(),
    /** Removes a member and clears the household from their sessions. */
    remove: (userId: string) => db.batch([g.removeMember(householdId, userId), g.clearActiveForMember(userId, householdId)]),
    invites: () => g.pendingInvites(householdId),
    createInvite: (p: { tokenHash: string; kind: 'member' | 'recovery' | 'owner'; role: Role | null; targetUserId?: string | null; email?: string | null; note?: string | null; createdBy: string; ttlMs: number }) =>
      g.createInvite({ ...p, householdId }),
    revokeInvite: (id: string) => g.revokeInvite(householdId, id),
    update: (p: Parameters<typeof g.updateHousehold>[1]) => g.updateHousehold(householdId, p),
    setAi: (enabled: boolean, userId: string, provider: string) => g.setAi(householdId, enabled, userId, provider),
    setSampleData: (v: boolean) => g.setSampleData(householdId, v).run(),
  };
}
