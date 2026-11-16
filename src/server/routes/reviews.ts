import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError } from '../http';
import { monthStr } from '../../shared/schemas/common';
import { newId, nowIso } from '../lib/crypto';
import { loadBase } from '../db/sql/facts';
import { availableReviewMonths, buildReviewFor, defaultReviewMonth, reviewDue } from '../db/sql/review';

export const reviewRoutes = tenantGroup();

const monthParam = (m: string) => {
  const r = monthStr.safeParse(m);
  if (!r.success) throw new HttpError(400, 'validation', 'Bad month');
  return r.data;
};

reviewRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const base = await loadBase(db, hh);
  const rows = await db.all<{ month: string; status: string; health_score: number | null; completed_at: string | null }>(
    "SELECT month, status, health_score, completed_at FROM reviews WHERE household_id = ?1 AND status = 'completed' ORDER BY month DESC",
  );
  return c.json({ defaultMonth: defaultReviewMonth(base), due: await reviewDue(db, base), available: availableReviewMonths(base).slice(0, 24), reviews: rows.map((r) => ({ month: r.month, status: r.status, healthScore: r.health_score, completedAt: r.completed_at })) });
});

/** A completed review reopens from its immutable snapshot; otherwise a draft is built on the fly. */
reviewRoutes.get('/:month', async (c) => {
  const { db, hh } = tctx(c);
  const month = monthParam(c.req.param('month'));
  const row = await db.first<{ status: string; snapshot_json: string | null; ai_json: string | null; completed_at: string | null }>(
    'SELECT status, snapshot_json, ai_json, completed_at FROM reviews WHERE household_id = ?1 AND month = ?2',
    month,
  );
  const ai = row?.ai_json ? JSON.parse(row.ai_json) : null;
  if (row?.status === 'completed' && row.snapshot_json) return c.json({ status: 'completed', completedAt: row.completed_at, snapshot: JSON.parse(row.snapshot_json), ai });
  return c.json({ status: 'draft', completedAt: null, snapshot: await buildReviewFor(db, hh, month), ai });
});

/** Hides the "review ready" card and nav badge for this month; the review itself stays available. */
reviewRoutes.post('/:month/dismiss', async (c) => {
  const { db, userId } = tctx(c);
  const month = monthParam(c.req.param('month'));
  await db.batch([
    db.stmt(
      `INSERT INTO reviews (id, household_id, month, status, dismissed_at) VALUES (?2, ?1, ?3, 'draft', ?4)
       ON CONFLICT(household_id, month) DO UPDATE SET dismissed_at = excluded.dismissed_at WHERE reviews.household_id = ?1`,
      newId(),
      month,
      nowIso(),
    ),
    db.audit(userId, 'review.dismiss', 'review', month),
  ]);
  return c.json({ ok: true });
});

reviewRoutes.post('/:month/complete', async (c) => {
  const { db, hh, userId } = tctx(c);
  const month = monthParam(c.req.param('month'));
  const row = await db.first<{ status: string }>('SELECT status FROM reviews WHERE household_id = ?1 AND month = ?2', month);
  if (row?.status === 'completed') throw new HttpError(409, 'review_completed', 'Review already completed');
  const snap = await buildReviewFor(db, hh, month);
  const now = nowIso();
  await db.batch([
    db.stmt(
      `INSERT INTO reviews (id, household_id, month, status, snapshot_json, health_score, completed_at, completed_by)
       SELECT ?2, ?1, ?3, 'completed', ?4, ?5, ?6, ?7
        WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE household_id = ?1 AND month = ?3 AND status = 'completed')
       ON CONFLICT(household_id, month) DO UPDATE SET status = 'completed', snapshot_json = excluded.snapshot_json, health_score = excluded.health_score,
         completed_at = excluded.completed_at, completed_by = excluded.completed_by`,
      newId(),
      month,
      JSON.stringify(snap),
      snap.summary.score,
      now,
      userId,
    ),
    db.audit(userId, 'review.complete', 'review', month),
  ]);
  return c.json({ status: 'completed', completedAt: now, snapshot: snap });
});
