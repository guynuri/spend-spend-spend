# Progress
Last updated: 2026-11-15T01:12Z — currently: M4 import pipeline (starting)

## Done
- **M0** (082f61d) — scaffold: Vite + Cloudflare plugin, Hono `/api/health` (D1 probe), wrangler
  config, migrations, Tailwind 4, ESLint with DB/i18n restrictions, Vitest unit + workerd/D1
  projects, Playwright (iphone + desktop), `npm run verify`.
- **M1** — shell: tab bar (phone) / start-side sidebar (≥1024 px), lazy routes with placeholders,
  light/dark/system theme, `en` + `he` catalogs with locale switch (`<html lang dir>`),
  `Money`/`DateText`, bottom-sheet dialogs, `ExplainSheet`, toasts, manifest + icons +
  Workbox SW (API NetworkOnly, denylisted from navigation fallback), update prompt, iOS
  install hint, offline banner, `_headers` + API security headers. AC2.1–2.5 covered by
  `pwa.spec`, `i18n-layout.spec` (14 routes × 2 locales, no overflow, screenshots reviewed),
  unit tests (key parity, plural categories, interpolation vars, money/date formatting,
  physical-direction class ban, restricted DB imports).

- **M2** — auth & tenancy: global + all tenant tables (migrations 0002/0003), passkey
  register/login (SimpleWebAuthn), bootstrap `/setup#token` (410 after first use), owner/member/
  recovery invites (hashed, single-use, expiring, constant-time bootstrap compare), sessions
  (`__Host-mz_session`, rolling 60 d / absolute 180 d, hourly refresh, logout / logout-all),
  CSRF (Origin + `X-MZ` + JSON), D1 rate limits, `tenantDb` (throws on unscoped SQL),
  `TENANT_TABLES` registry, household/role middleware, members & invites UI, household
  switcher, admin UI (metadata only), cron cleanup, `npm run admin:recovery`.
  AC1.1–1.9: API tests with a software authenticator (real WebAuthn verification), isolation
  suite (route classification + cross-household + canary + registry), e2e `01-setup`,
  `02-auth`, `08-household` (Chromium CDP virtual authenticator).

- **M3** — accounts (CRUD, archive-if-used, manual balance snapshot, variance), categories
  (defaults per locale, add/rename/regroup, archive-if-used), rules (seed/user/learned, SQL rule
  pass, precedence), ledger (URL filters, normalized search, 50-row cursor paging, phone card
  list / table ≥ 768 px, transaction sheet, learned rules with "N more categorized" + Undo, split
  editor with exact-sum check and "same as last time", bulk categorize, CSV export with BOM and
  formula-injection guard, manual entry), demo generator + `POST /api/household/sample-data` +
  `npm run seed:local`. AC3.1–3.7: `tests/api/ledger.test.ts`, `tests/unit/ledger.test.ts`,
  e2e `04-ledger.spec.ts`; isolation suite now runs over demo data with the canary in every B
  text field.

## In progress
- M4 — import pipeline.

## Blocked / stubbed
- **SheetJS CDN** unreachable (proxy 403) → `xlsx@0.18.5` from npm (DECISIONS D-R2,
  `TODO(sheetjs-cdn)`).
- **Deploy**: no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in the environment, no
  `.env.local`, and `api.cloudflare.com` is blocked by the network policy → M11 will not deploy;
  `npm run deploy` will be left ready.

## Environment (M0 check, names only)
- Node v22.23.4, npm 10.9.9; npm registry reachable; `cdn.sheetjs.com` blocked;
  `api.cloudflare.com` blocked.
- Not present: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `AI_API_KEY`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `.env.local`.
- `fixtures/otsar-hahayal/private/`: empty → synthetic fixtures only (`TODO(otsar-real-file)`).

## Verification
- M3: `npm run verify` green — unit 25, api 35, e2e 20.

## Security checklist
- (ticked in M10)

## Deviations
- See DECISIONS.md D-R1 … D-R5.
