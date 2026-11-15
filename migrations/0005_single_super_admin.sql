-- At most one super-admin (closes the bootstrap race: a second concurrent setup fails here).
CREATE UNIQUE INDEX users_single_super_admin ON users(is_super_admin) WHERE is_super_admin = 1;
