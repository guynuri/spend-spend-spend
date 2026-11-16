-- The app tour's demo households (`~demo-he`, `~demo-en`, built by src/server/seed/demoHousehold.ts)
-- are shared by everyone and must never get members or invites: no one may own or write to them.
CREATE TRIGGER demo_no_membership BEFORE INSERT ON memberships WHEN NEW.household_id LIKE '~demo-%'
BEGIN SELECT RAISE(ABORT, 'demo household'); END;
CREATE TRIGGER demo_no_invite BEFORE INSERT ON invites WHEN NEW.household_id LIKE '~demo-%'
BEGIN SELECT RAISE(ABORT, 'demo household'); END;
