# Decisions log

Deviations from and clarifications of `PLAN.md`, made during the autonomous build run.
Format: date · milestone · what · why · alternatives rejected.

## D-R1 · 2026-11-14 · M0 · Branch based on `main`
- **What:** the session branch `claude/funny-fermat-i0vsdy` did not contain `PLAN.md`; it was
  fast-forwarded to `origin/main` (which adds `PLAN.md`, `OPUS_KICKOFF.md`, `PREREQS.md`).
- **Why:** PREREQS §6 says to base the session on the branch containing the plan. Fast-forward
  only, no history rewrite.

## D-R2 · 2026-11-14 · M0 · SheetJS from npm (`xlsx@0.18.5`) instead of the CDN tarball
- **What:** `cdn.sheetjs.com` is blocked by this session's network policy (proxy 403). Per
  PLAN §4.1 fallback, `xlsx@0.18.5` from npm is used. It runs only in the browser on the
  user's own file.
- **TODO(sheetjs-cdn):** replace with `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` when
  the CDN is reachable (`npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`).
- **Rejected:** vendoring a tarball from an unofficial mirror.

## D-R3 · 2026-11-14 · M0 · Vitest Workers integration package renamed
- **What:** `@cloudflare/vitest-pool-workers` is deprecated and renamed
  `@cloudflare/vitest-plugin` (plugin `cloudflareTest()`); that is what the API project uses.
  Vitest 5.x. TypeScript pinned to 5.9 because `typescript-eslint` does not yet support TS 7.

## D-R4 · 2026-11-14 · M0 · Workers AI binding only in `env.production`
- **What:** `wrangler.jsonc` top level (local dev, tests, e2e) has **no** `ai` binding; the
  `production` environment repeats the D1 binding, vars and crons and adds `ai`. Deploy builds
  with `CLOUDFLARE_ENV=production`. Worker name stays `maazan`.
- **Why:** the Workers AI binding is always remote; with it configured, `vite dev` / `wrangler
  dev` try to open a remote proxy session and fail without Cloudflare credentials, breaking
  local dev and e2e. Locally AI is `mock` (e2e) or unavailable.
- **Rejected:** requiring credentials for local dev; generating the config at deploy time.

## D-R5 · 2026-11-14 · M0 · E2E server = `wrangler dev` on the built output
- **What:** Playwright's webServer runs `scripts/e2e-server.mjs`: build, fresh local D1 in
  `.wrangler/e2e`, `wrangler d1 migrations apply --local`, then `wrangler dev -c
  dist/maazan/wrangler.json --var AI_PROVIDER:mock --var BOOTSTRAP_TOKEN:e2e-bootstrap`.
- **Why:** test-only values are passed on the command line, so no `.dev.vars` is needed and
  nothing test-specific lands in `wrangler.jsonc`.

## D-R6 · 2026-11-15 · M2 · Schema additions beyond PLAN §5
- `auth_challenges.user_id`, `.display_name`: carry the pending registration (WebAuthn user
  handle and name) between options and verify, so verify never trusts client-sent identity.
- `households.locale`: language of the default category names / seed data for that household.
- `memberships.last_used_at`: "most recently used membership" for the active household at login.
- `invites.email`: optional address the link was emailed to.
- `imports.closing_balance_minor/closing_date`, `import_rows` (staging table for chunked uploads),
  `transactions.merged_import_id` (lets "Undo import" revert manual rows merged into it).
- All tenant tables were created in M2 (migration 0003) instead of M3 so the table registry
  and the isolation suite are complete from the start. `memberships` and `invites` carry a
  `household_id` but are global auth tables reached only through `db/global.ts`; the registry
  test lists them as the explicit exceptions.

## D-R7 · 2026-11-15 · M2 · Auth details
- Bootstrap: the setup page also asks for a household name (prefilled "Our home").
- Recovery links are valid 2 days, invites 7 days. Unknown/used/expired/revoked tokens all
  answer 410 `invite_invalid` (no oracle) and count toward the 5 / 15 min token-failure limit.
- Admin household list includes owner display names (metadata, needed for "owner recovery
  link"); never amounts, descriptions or balances (asserted by the isolation suite).
- Auth route limit is a var `RATE_LIMIT_AUTH` (default 20 / 5 min / IP); the local e2e server
  raises it because every e2e test signs in from 127.0.0.1.
- Household member/invite operations go through `tenantDb(...).members` (db/members.ts), so
  `routes/household.ts` never imports `db/global.ts`.
- API tests exercise real WebAuthn registration and login with a small software authenticator
  (`tests/api/softauthn.ts`, ES256, attestation "none"); e2e uses Chromium's CDP virtual
  authenticator and replays saved credentials (with their sign counter) into new contexts.

## D-R8 · 2026-11-15 · M3 · Ledger details
- `transactions.description_norm` stores `normKey(description)` (the rules/dedupe form).
  Search matches `description_norm` (niqqud/quotes/spaces-insensitive) **or** the raw lowercased
  description, notes and reference (so digit runs such as references are still findable).
- `operation_type` is stored as `norm(...)` so `operation_type` rules can match in SQL.
- The rule pass runs entirely in SQL (`UPDATE … FROM` with a correlated "winning rule" subquery
  ordered user > learned > ai > seed, longer pattern first). A pure TS twin
  (`shared/domain/ledger.ts`) is unit-tested for the same precedence.
- Learning from a manual categorization upserts an `equals` rule on `normKey(description)` with
  the transaction's sign and applies it to the other uncategorized matches; the response returns
  the affected ids so "Undo" reverts exactly those and deletes the learned rule.
- Card-issuer patterns that are Latin words (`cal`, `max it`, `visa` …) match on word
  boundaries only, so "local cafe" is not a card charge.
- Imported fields (date, amount, description, account) are read-only; category, notes, splits
  and recurring link are editable. Manual transactions are fully editable.
- Categories and rules have their own page (`/categories`, reached from More) rather than living
  inside Settings.
- Bulk inserts (demo data now, imports in M4) use one `INSERT … SELECT … FROM json_each(?2)`
  statement per ≤ 400 rows (`tenantDb.bulkInsertStmts`) to stay within D1's per-invocation
  query limit.
- The demo generator is complete from M3 (accounts, ~7 months of transactions with split card
  lumps, recurring items, budgets, goals, planned expenses). `npm run seed:local` bundles it
  with esbuild and loads it through `wrangler d1 execute --local`.

## D-R9 · 2026-11-15 · M4 · Import pipeline details
- Chunked upload state lives in a staging table `import_rows` (one row per ≤ 250-row chunk, JSON);
  commit runs set-based SQL over `json_each` of the staged chunks: pair-and-merge manual matches,
  `INSERT … ON CONFLICT DO NOTHING`, card-lump flag, rule pass, closing-balance snapshot. The
  server recomputes dedupe keys and normalized text from the wire rows; preview never writes.
- Manual ↔ import merge pairs each manual row with at most one imported row (same account,
  same amount, ±3 days, nearest date first) via window functions. The manual row adopts date,
  description, reference, balance and key, keeps category/notes/splits, and stores its original
  fields in `transactions.pre_merge_json` (migration 0004) so "Undo import" restores it exactly.
- Ids of imported transactions are generated in SQL (`substr(lower(hex(randomblob(11))),1,21)`,
  21 hex chars) instead of nanoid, to keep the insert a single statement.
- Otsar parser ordering: rows are put in chronological order (stable by date); within a day the
  file order or its reverse is chosen by the running-balance continuity check, newest-first
  files trying the reversed order first. A `0` balance on a day that has a real balance is
  "missing"; any other `0` that breaks continuity is also treated as missing.
- Rows without a date are skipped silently only when the date cell is empty **and** there is no
  reference (totals/footers); otherwise `date_invalid`. Description falls back to the operation
  type; both empty → `description_missing`.
- Error report CSV is produced in the browser from the parse result (the server only stores the
  count), since the rows never existed server-side.
- SheetJS npm build: in the browser the ESM build needs `set_cptable(cpexcel.full.mjs)` for
  windows-1255; Node's CJS build bundles code pages. `grid.ts` handles both.
- The file input is disabled until an account is selected (fixes a race found by e2e where a
  file chosen before the account list loaded was previewed without an account).
