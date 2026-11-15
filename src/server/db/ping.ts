export async function pingDb(db: D1Database): Promise<boolean> {
  try {
    const r = await db.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return r?.ok === 1;
  } catch {
    return false;
  }
}
