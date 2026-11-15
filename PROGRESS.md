# Progress
Last updated: 2026-11-15T02:08Z — currently: M9 AI (starting)

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

- **M4** — import: synthetic fixtures (`npm run gen:fixtures`: Otsar xlsx newest-first, BIFF
  .xls, overlapping file oldest-first, shifted header, HTML-in-.xls, windows-1255 generic CSV,
  broken file) with `expected.json`; sniff (magic bytes) + decode (UTF-8/16/1255) + grid (SheetJS
  lazy chunk, Papa Parse); Otsar parser (header by Hebrew names, period, last-4 mask, serial
  dates, credit−debit, zero-balance handling, continuity check); generic mapper with editable
  mapping, date-format detection, sign flip, saved profiles per account + header signature;
  occurrence index + dedupe key; preview (new / duplicate / matches-manual / errors, first 200
  rows with suggested category); chunked commit (≤ 250/request, ≤ 5,000/import) with merge,
  card-lump flag, rules, balance snapshot; history + undo; error report CSV.
  AC4.1–4.9: `tests/unit/import.test.ts` (19), `tests/api/imports.test.ts` (5), e2e
  `03-import.spec.ts` (7) + `11-screens.spec.ts`. Real-file test runs only if
  `fixtures/otsar-hahayal/private/` has files (empty here → `TODO(otsar-real-file)`).

- **M5** — budgets: per-category limits effective from M onward (inline edit), spent/remaining/
  utilization bar (green/amber/red + icon), 3-month average, status per §10.4, totals with
  % spent vs % of month elapsed + pace sentence, over/watch/on-pace counts, fixed/variable
  sub-totals, unbudgeted row, allocation check with explain sheet, unsplit-card banner (AC5.5)
  linking to card charges, 6-month history chart, distribution bars, category sheet with
  6-month chart. Trends: by category (tap → ledger), by day (daily bars + cumulative vs last
  month), over 12 months (income/spending/net, or one category). AC5.1–5.5, AC10.1:
  `tests/unit/budget.test.ts`, `tests/api/budgets.test.ts`, e2e `06-budget-goals.spec.ts`.

- **M6** — recurring registry (CRUD, pause, fixed/estimated, all cadences, per-occurrence
  override/skip), detection after import (suggested → confirm/dismiss), settlement linking after
  import/manual writes, card estimate = mean of last ≤ 3 charges, monthly/yearly totals; planned
  expenses (account or card, auto-done on match); forecast engine per §10.3 (start at A, late/
  missed/overdue, variable baseline, card + planned-by-card, series to end of next month, low
  point, after-next-card, confidence, exact breakdown) with card/page/chart/explain sheet;
  upcoming 45-day list with running balance. AC6.1–6.6, AC7.1–7.4: `tests/unit/recurring.test.ts`
  (13), `tests/unit/forecast.test.ts` (15, every §10.3 edge case + exact-sum invariant + AC7.2),
  `tests/api/forecast.test.ts` (6), e2e `05-forecast.spec.ts`.

- **M7** — goals (target/date/start, contributions, required monthly, on track/behind, pace +
  projected finish, 25/50/75/100 % milestones, auto-complete, summary + capital allocation);
  health score (5 sub-scores on published curves, null rules + re-normalization, labels, change,
  6-month trend, top-3 recommendations with point gains) with explain sheet; action items (all
  §10.7 rules, severity order, ≤ 8); Overview dashboard in AC11.1 order with "latest data"
  banner; onboarding (upload / sample data), persistent sample-data banner with clear; reset /
  delete household (typed confirmation). AC8.x, AC9.x, AC11.x, AC14.1, AC15.1:
  `tests/unit/health-goals.test.ts` (50), `tests/api/dashboard.test.ts` (5), e2e
  `06-budget-goals.spec.ts`, `08-household.spec.ts` (sample data + clear).

- **M8** — monthly review: language-neutral snapshot builder (7 chapters, rule-chosen
  commentary keys, headline by score label × change, chips, notable transactions, wins / watch
  list / next steps), stepper UI with progress, back/next, skip to wrap-up; "Complete review"
  stores an immutable snapshot; history reopens from it; demo ships a completed review.
  AC12.1–12.2: `tests/api/reviews.test.ts`, unit review-builder test, e2e `07-review-ai.spec.ts`
  (AI-off path), `12-review-screens.spec.ts`.

## In progress
- M9 — AI (opt-in).

## Blocked / stubbed
- **SheetJS CDN** unreachable (proxy 403) → `xlsx@0.18.5` from npm (DECISIONS D-R2,
  `TODO(sheetjs-cdn)`).
- **Otsar real file**: `fixtures/otsar-hahayal/private/` is empty in this session, so the
  parser is verified against synthetic fixtures only (`TODO(otsar-real-file)` in `otsar.ts`).
  To finish: drop a real export there and run `npm run test:unit` (prints nothing from it).
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
- M8: `npm run verify` green — unit 130, api 54, e2e 39.

## Security checklist
- (ticked in M10)

## Deviations
- See DECISIONS.md D-R1 … D-R5.
