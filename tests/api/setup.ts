import { applyD1Migrations, env } from 'cloudflare:test';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
