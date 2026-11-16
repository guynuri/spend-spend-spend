import { Hono } from 'hono';
import { APP_VERSION } from '../shared/app';
import type { AppCtx } from './types';
import { pingDb } from './db/ping';
import { bodyLimit, headers, onError, requestId } from './middleware/base';
import { csrf, loadSession, rateLimit } from './middleware/auth';
import { errorBody } from './http';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { householdRoutes } from './routes/household';
import { accountRoutes } from './routes/accounts';
import { categoryRoutes } from './routes/categories';
import { ruleRoutes } from './routes/rules';
import { transactionRoutes } from './routes/transactions';
import { importProfileRoutes, importRoutes } from './routes/imports';
import { budgetRoutes } from './routes/budgets';
import { trendRoutes } from './routes/trends';
import { dashboardRoutes } from './routes/dashboard';
import { reviewRoutes } from './routes/reviews';
import { aiRoutes } from './routes/ai';
import { goalRoutes, healthRoutes } from './routes/goals';
import { forecastRoutes, plannedRoutes, recurringRoutes, upcomingRoutes } from './routes/recurring';
import { reminderRoutes } from './routes/reminders';
import './ai/register';

/** Mounted tenant route groups: prefix → router. Each is behind household + role middleware. */
export const TENANT_GROUPS = {
  '/api/household': householdRoutes,
  '/api/accounts': accountRoutes,
  '/api/categories': categoryRoutes,
  '/api/rules': ruleRoutes,
  '/api/transactions': transactionRoutes,
  '/api/imports': importRoutes,
  '/api/import-profiles': importProfileRoutes,
  '/api/budgets': budgetRoutes,
  '/api/trends': trendRoutes,
  '/api/recurring': recurringRoutes,
  '/api/planned': plannedRoutes,
  '/api/forecast': forecastRoutes,
  '/api/upcoming': upcomingRoutes,
  '/api/goals': goalRoutes,
  '/api/health-score': healthRoutes,
  '/api/dashboard': dashboardRoutes,
  '/api/reviews': reviewRoutes,
  '/api/ai': aiRoutes,
} as const;

export function createApp() {
  const app = new Hono<AppCtx>();
  app.use('/api/*', requestId, headers);
  app.onError(onError);
  app.use('/api/*', bodyLimit);
  // Only the unauthenticated ceremonies are limited; signed-in pages (passkey / device lists) must not
  // eat into a household's shared-IP sign-in allowance.
  for (const path of ['/api/auth/register/*', '/api/auth/login/*', '/api/invites/*'])
    app.use(path, async (c, next) => rateLimit('auth', Number(c.env.RATE_LIMIT_AUTH || 20), 5 * 60_000)(c, next));
  app.use('/api/*', csrf, loadSession);

  app.get('/api/health', async (c) => {
    // eslint-disable-next-line no-restricted-syntax -- the health check is the one non-tenant DB probe
    const db = await pingDb(c.env.DB);
    return c.json({ ok: true, version: APP_VERSION, db });
  });

  app.route('/api', authRoutes);
  app.route('/api', adminRoutes);
  for (const [prefix, r] of Object.entries(TENANT_GROUPS)) app.route(prefix, r);
  // per-user, behind the household middleware (any role manages their own reminders)
  app.route('/api/reminders', reminderRoutes);

  app.all('/api/*', (c) => c.json(errorBody('not_found', 'No such API route'), 404));
  return app;
}

export const app = createApp();
