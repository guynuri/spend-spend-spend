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
