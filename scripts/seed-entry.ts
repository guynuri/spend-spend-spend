// Bundled by scripts/seed-local.mjs: prints SQL that loads the demo into one local household.
import { buildDemo, categoryKeyMap, DEMO_TABLE_ORDER } from '../src/server/seed/demo';
import { newId, nowIso } from '../src/server/lib/crypto';

const [householdId, today, locale, catsJson] = process.argv.slice(2) as [string, string, 'en' | 'he', string];
const cats = JSON.parse(catsJson) as { id: string; name: string; system_key: string | null }[];
const data = buildDemo(today, locale, categoryKeyMap(cats), newId, nowIso());
const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const out: string[] = [];
for (const t of DEMO_TABLE_ORDER) for (const row of data[t]) out.push(`INSERT INTO ${t} (household_id, ${Object.keys(row).join(', ')}) VALUES (${lit(householdId)}, ${Object.values(row).map(lit).join(', ')});`);
out.push(`UPDATE households SET has_sample_data = 1 WHERE id = ${lit(householdId)};`);
process.stdout.write(out.join('\n'));
