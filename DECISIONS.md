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
