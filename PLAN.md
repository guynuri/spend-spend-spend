# PLAN.md — Maazan (מאזן): household money PWA

> Build plan for one unattended, autonomous build run. Everything here is decided. If something
> is still ambiguous, pick the option most consistent with this file, log it in `DECISIONS.md`,
> and continue. `REFERENCE.md` is a **feature reference only** (a closed commercial product):
> never copy its text, names, branding or visual design.

Contents: 1 Product · 2 Scope map · 3 MVP spec + acceptance criteria · 4 Architecture ·
5 Data model · 6 Tenancy & isolation · 7 Auth · 8 API · 9 Import pipeline · 10 Domain algorithms ·
11 AI · 12 i18n/RTL · 13 PWA/iPhone · 14 Demo data · 15 Testing · 16 Milestones ·
17 Deployment · 18 Security checklist · 19 Decisions · 20 Later / Dropped

---

## 1. Product

**Maazan** ("balance" in Hebrew) is an invite-only, multi-household money app. A household
uploads its monthly bank export (Excel/CSV, no bank connection ever), and gets: a categorized
ledger, budgets with pace, recurring payments and an upcoming-payments list, an end-of-month
balance forecast with the lowest point on the way, goals, a 0–100 health score with published
formulas, spending trends, and a guided monthly review whose narrative can optionally be
rewritten by a free-tier AI model.

Principles (in priority order):
1. **Works without AI.** Every number, insight and review chapter is deterministic.
2. **Every number is defined once** in `src/shared/domain/` and explained in the UI ("How is
   this calculated?" sheet showing the formula and the inputs used).
3. **Households are sealed.** No code path reads tenant data without a household id that came
   from the session.
4. **iPhone first.** Designed at 390 px wide, touch targets ≥ 44 px, standalone PWA.
5. **$0.** Cloudflare Workers Free + D1 Free + Workers AI free allocation. No paid dependency.

The app name lives in one constant (`src/shared/app.ts: APP_NAME`) and the manifest.

---

## 2. Scope map (reference → ours)

| Reference feature (REFERENCE.md §) | Decision | Notes |
|---|---|---|
| App shell, nav, period in header (§0) | **MVP** | Bottom tab bar on mobile, sidebar ≥ 1024 px |
| Light/dark/system theme (§0) | **MVP** | |
| "Explain this metric" (§0) | **MVP** | `ExplainSheet` on every computed metric |
| Nav status badges (§0) | **MVP** | Only: uncategorized count on Ledger, over-budget dot on Budget |
| Command palette, page briefing button, feedback button (§0) | Drop | |
| Dashboard (§1) | **MVP** | Health score, month P&L (actual vs expected), forecast card, action items, budget summary, goals summary, upcoming payments |
| Dashboard "financial position / net worth" (§1) | Later | MVP shows account balances only |
| Ledger: search, filters in URL, edit, bulk categorize, split, CSV export (§2) | **MVP** | Card list on mobile, table ≥ 768 px |
| Ledger chart view, tags, inline table-cell editing (§2) | Later | Edit happens in a sheet |
| Manual transaction entry | **MVP** | |
| Categories + auto-categorization rules (§2 Ours) | **MVP** | Rules learned from manual categorization |
| Budget workspace, pace, allocation check, history + distribution charts (§3) | **MVP** | Budget edit inline; no 3-step wizard |
| Recurring registry + deterministic detection (§4) | **MVP** | No "subscriptions health score" |
| Upcoming list (§5) | **MVP** | Next 45 days, grouped by date, incl. card charge + salary |
| Bill calendar month grid (§5) | Later | |
| Accounts registry: checking/savings/cash/card, balances from import, manual balance (§6) | **MVP** | Variance shown per account |
| Reconciliation queue, property/vehicle/loans, balance sheet, net-worth chart (§6) | Later | |
| Goals: list, target/date/required monthly, contributions, status, capital allocation (§7) | **MVP** | |
| Goal roadmap/Gantt, dependencies, AI roadmap analysis (§7) | Later | |
| Monthly guided review, 7 chapters, saved history (§8) | **MVP** | Rule-generated; AI rewrites commentary only |
| Weekly / quarterly reviews, partner briefing (§8) | Later | |
| Health score, 5 sub-scores, ranked recommendations with point gains (§9) | **MVP** | Own names, own curves (§10.6) |
| Radar chart (§9) | Drop | Bars + trend line are enough |
| End-of-month forecast + lowest point (§10 Ours) | **MVP** | Daily series to end of next month |
| Projections 6–12 months, scenario sliders (§10) | Later | |
| Planned future expenses | **MVP** | Not in the reference; user requirement |
| Trends: by category, by day, over months (§12 partial) | **MVP** | One "Trends" page |
| PDF reports, Sankey, statements (§12) | Later | |
| AI advisor chat (§13) | Later | |
| AI categorization (§2) | **MVP** | Suggestions the user accepts |
| Households, roles owner/member/viewer, invites (§14) | **MVP** | |
| Category-level visibility, partner dashboard, audit-trail UI, notifications (§14) | Later | Security events are still written to `audit_log` |
| Reset data / delete household (§14) | **MVP** | |
| Debt payoff, retirement, portfolio (§11) | Later / Drop | Portfolio advice: Drop |
| Bank aggregation (§6) | **Drop — never** | |
| Google / password / magic-link sign-in (§14) | Drop | Passkeys + invite links (§7) |
| Card-issuer file import linked to the lump (§15) | Later | MVP: split the lump by hand, "same as last month" |
| English + Hebrew UI | **MVP (both)** | See D-2 |

---

## 3. MVP spec with acceptance criteria

Each criterion is testable; the test type that must cover it is in brackets
(U = unit, A = API/integration, E = Playwright e2e on iPhone viewport).

### F1 Auth & tenancy
- AC1.1 First run: opening `/setup#<BOOTSTRAP_TOKEN>` with no super-admin in the DB lets the
  visitor enter a display name and create a passkey; they become super-admin and owner of a new
  household. A second attempt returns HTTP 410. [A, E]
- AC1.2 Sign-in is usernameless passkey (discoverable credential). No password anywhere. [E]
- AC1.3 Super-admin can create a household (name) and gets a single-use owner invite link
  (7-day expiry) to copy/share. Super-admin sees per household only: name, status, member
  count, created date, last import date. Never transactions or amounts. [A, E]
- AC1.4 Owner can invite members with role `member` or `viewer`, see pending invites, revoke
  them, change a member's role, remove a member. The last owner cannot be removed or demoted. [A]
- AC1.5 `viewer` gets HTTP 403 `forbidden_role` on every non-GET tenant endpoint; UI hides
  write controls. [A]
- AC1.6 A user of household A requesting any tenant resource by id that belongs to household B
  gets 404, for **every** tenant route (auto-enumerated). No response body ever contains B's
  data. [A — the isolation suite, §15.3]
- AC1.7 Invite/recovery tokens: 32 random bytes, stored only as SHA-256, single use, expire;
  reuse → 410. [A]
- AC1.8 Session cookie is `__Host-mz_session`; HttpOnly, Secure, SameSite=Lax, Path=/; rolling
  60 days, absolute 180 days; sign-out deletes the row; "sign out everywhere" deletes all. [A]
- AC1.9 Owner or super-admin can issue a recovery link for a member who lost their passkey;
  `npm run admin:recovery` issues one for the super-admin. [A]

### F2 Shell, i18n, PWA
- AC2.1 Lighthouse-installable: manifest (name, icons 192/512/maskable, `display: standalone`),
  apple-touch-icon, service worker. `/api/*` is never served from cache. [E: manifest + SW
  registered; A: `Cache-Control: no-store` on API]
- AC2.2 At 390×844 no page scrolls horizontally (`documentElement.scrollWidth <=
  clientWidth`) in `en` and `he`. [E, all main routes]
- AC2.3 Safe areas: tab bar and sheets pad with `env(safe-area-inset-*)`; `viewport-fit=cover`;
  inputs are ≥ 16 px font (no iOS zoom). [E: computed style checks]
- AC2.4 Every user-visible string comes from the catalog; `en` and `he` catalogs have identical
  key sets; switching to Hebrew sets `<html lang="he" dir="rtl">`. [U: key parity; lint:
  no literal JSX strings; E]
- AC2.5 Amounts render via `Intl.NumberFormat` in the household currency (₪ default) inside
  `<bdi>`; dates via `Intl.DateTimeFormat`; week starts Sunday in `he`. [U]

### F3 Accounts, categories, ledger
- AC3.1 Accounts: create/edit/archive; types checking/savings/cash/credit_card; flags
  `include_in_forecast`, `is_liquid`; opening balance + date; manual "set balance as of date". [A]
- AC3.2 New household gets the default category set (§5.3) and seed rules. Categories can be
  added, renamed, re-grouped (fixed/variable), archived; a category in use is archived, not
  deleted. [A]
- AC3.3 Manual transaction: date, amount, direction, description, account, category, notes. [A, E]
- AC3.4 Ledger list: default range = current month; filters (account, category, uncategorized
  only, text search, date range) are reflected in the URL query string; pagination by cursor,
  50 per page. Search is insensitive to case, niqqud, quote variants, extra spaces. [A, U norm]
- AC3.5 Setting a category by hand creates a learned rule and applies it to the other
  uncategorized transactions that match; a toast reports "N more categorized" with Undo. [A, E]
- AC3.6 Split: lines must sum exactly to the parent amount (server rejects otherwise with
  `split_sum_mismatch`); budget and trends use split lines. "Same as last time" pre-fills the
  split of the most recent split transaction with the same `kind`/payee scaled to the new
  amount, rounding remainder to the largest line. [U, A]
- AC3.7 Bulk: select many → set category. Export current filter as UTF-8 CSV with BOM. [A]

### F4 Import
- AC4.1 File chosen by `<input type="file">` (opens iOS Files) or drag & drop; accepted:
  .xlsx, .xls (BIFF or HTML-table-in-.xls), .csv (UTF-8 or windows-1255); > 5 MB or other
  types rejected with a translated message before parsing. [U sniffing, E]
- AC4.2 The file is parsed **in the browser**; the raw file and the full account number never
  leave the device. [A: import endpoints accept only normalized rows; U]
- AC4.3 Otsar Ha-Hayal parser handles the layout in REFERENCE.md §18: header row found by
  Hebrew column names anywhere in the first 30 rows, Excel-serial dates, credit/debit columns,
  padded descriptions, zero-balance rows treated as "balance missing". [U on synthetic
  fixtures, + the private real fixture when present]
- AC4.4 Unknown layout → generic mapper: detected header row and guessed columns are shown and
  editable (date, description, amount **or** debit+credit, optional balance/reference/value
  date/type, date format, sign flip); the mapping is saved per account and reused when the
  header signature matches. [U, E with a windows-1255 CSV]
- AC4.5 Preview before any write: counts of new / duplicate / matches-manual-entry / error
  rows, detected period, closing balance, balance-continuity warning, first 200 rows with
  status and suggested category. [A, E]
- AC4.6 Re-importing the same file inserts 0 rows; importing a file overlapping a previous one
  inserts only the new rows; two genuinely identical transactions on one day are both kept. [U, A, E]
- AC4.7 Error report: every skipped row with row number + reason code, downloadable as CSV;
  an import with errors still commits the valid rows. [U, A]
- AC4.8 Import history per household with "Undo import" (deletes that import's transactions
  and its balance snapshot). [A]
- AC4.9 After commit: rules applied, card-lump rows flagged, recurring/planned items matched,
  recurring detection re-run, account balance snapshot stored. [A]

### F5 Budgets
- AC5.1 Per-category monthly limit, edited inline; a change in month M applies to M and later
  months until changed again; earlier months keep their value. [U, A]
- AC5.2 Per category: limit, spent, remaining/over, utilization bar (green / amber / red),
  3-month average, status per §10.4. Header: total budgeted, total spent, % spent vs % of
  month elapsed, counts over / watch / on pace, unbudgeted spending row. [U, A]
- AC5.3 Allocation check: budgeted total vs average monthly income (last 3 complete months):
  "₪X of ₪Y allocated". [U]
- AC5.4 Dashboard budget summary and Budget page show identical numbers (same function). [A]
- AC5.5 If the month contains unsplit card-lump charges, a banner states the amount and links
  to the split sheet. [A, E]

### F6 Recurring, upcoming, planned
- AC6.1 Recurring item: name, kind (expense/income/card_charge), amount, fixed/estimated,
  cadence (weekly, monthly, every 2/3 months, yearly), day, account, category, match text,
  start/end, pause. [A]
- AC6.2 Detection (§10.2) proposes `suggested` items after import; user confirms or dismisses;
  dismissed patterns are not proposed again. [U, A]
- AC6.3 A card_charge item's next amount = mean of its last ≤ 3 matched charges, overridable
  per occurrence ("I expect ₪X on the 10th"). [U, A, E]
- AC6.4 Upcoming list: next 45 days of unsettled occurrences + planned expenses, grouped by
  date, with running projected balance; an occurrence can be marked skipped or its amount
  edited for that date only. [U, A]
- AC6.5 Planned expense: name, amount, date, category, pay-from (account, or a card → lands in
  that card's next charge), status planned/done/cancelled; auto-marked done when an imported
  transaction is linked. [U, A]
- AC6.6 Totals: monthly and yearly cost of active recurring expenses. [U]

### F7 Forecast
- AC7.1 Forecast card shows: expected balance on the last day of the current month, lowest
  point (date + amount) between today and month end, balance after the next card charge, the
  data-as-of date, and a confidence label. Chart: daily projected balance to end of next month
  with a "today" marker. [U, A, E]
- AC7.2 Adding a planned expense of ₪X paid from a forecast account, dated before month end,
  lowers the end-of-month figure by exactly ₪X. [U, E]
- AC7.3 "How is this calculated?" lists start balance, expected income, recurring, card
  charges, planned, variable-spend estimate — and they sum to the end-of-month figure to the
  agora. [U]
- AC7.4 All edge cases in §10.3 are unit-tested (stale data, no history, month-length
  clamping, overdue items, overrides, no forecast accounts). [U]

### F8 Goals
- AC8.1 Goal: name, target amount, optional target date, start date, starting amount,
  priority; contributions (date, amount, note); status and required monthly per §10.5. [U, A]
- AC8.2 Summary: active count, total saved / total target, count behind; capital allocation =
  Σ required monthly vs average monthly surplus. [U]
- AC8.3 Reaching 25/50/75/100 % shows a milestone marker; 100 % sets status completed. [U]

### F9 Health score
- AC9.1 Score 0–100 with label, five weighted sub-scores exactly per §10.6, month-over-month
  change, 6-month trend. [U with table-driven tests on every breakpoint]
- AC9.2 Missing inputs make a sub-score "not enough data" and re-normalize the weights; fewer
  than 2 computable sub-scores → no overall score, with an explanatory empty state. [U]
- AC9.3 Up to 3 recommendations, each with the recomputed point gain. [U]

### F10 Trends
- AC10.1 By category for a month (bars + share), by day for a month (daily spending bars and
  cumulative line vs previous month), over months (income / expenses / net for 12 months; one
  category over 12 months). Tapping a category opens the ledger filtered to it. [A, E smoke]

### F11 Dashboard & action items
- AC11.1 Cards in order: forecast, month P&L (actual vs expected), action items, budget
  summary, upcoming (next 5), goals, health score. With no data: onboarding card (upload /
  sample data). [E]
- AC11.2 Action items are generated by the rules in §10.7; each links to the relevant page. [U]
- AC11.3 Displayed month = current month if it has transactions, else the month of the latest
  data, with a "latest data: <month>" banner. [U]

### F12 Monthly review
- AC12.1 Seven chapters (§10.8) with progress, back/next, jump to wrap-up; every chapter fully
  rendered with AI disabled. [A, E]
- AC12.2 "Complete review" stores an immutable snapshot; past reviews are listed and reopen
  from the snapshot. [A]
- AC12.3 With AI enabled, "Write commentary with AI" replaces chapter commentary and the
  headline, labelled "AI-written" with the disclaimer; on any AI failure the rule text stays
  and a toast explains. [A with mock provider, E]

### F13 AI (opt-in)
- AC13.1 Off by default per household. Only an owner can enable, through a consent sheet that
  names the provider and model, lists exactly what is sent and not sent, states whether the
  provider trains on inputs, and shows the daily limits. Consent (who/when) is stored. [A, E]
- AC13.2 Categorization requests contain only: normalized merchant text (digits ≥ 5 long and
  e-mail addresses stripped), sign, rounded amount, and the category names. Review requests
  contain only aggregates (no descriptions, no account identifiers, no names). [U: payload
  builders snapshot-tested against a PII canary]
- AC13.3 Limits: per household/day 10 categorize calls + 5 review calls; global/day 150 calls.
  Over limit → 429 `ai_rate_limited`, UI falls back. [A]
- AC13.4 With `AI_PROVIDER=none` or AI disabled, no AI control errors: buttons show an
  "Enable AI in Settings" hint (owner) or are hidden (others). [E]

### F14 Demo data & onboarding
- AC14.1 An empty household shows two choices: upload a statement, or load sample data. Sample
  data (§14) fills every page; a persistent banner offers "Clear sample data". [A, E]

### F15 Data control
- AC15.1 Owner can reset the household's data or delete the household (typed confirmation);
  all tenant rows are removed (table registry, §6). [A]

---

## 4. Architecture

### 4.1 Stack (named; install latest stable of each, commit the lockfile)
| Concern | Choice |
|---|---|
| Language | TypeScript (strict), Node ≥ 22 for tooling |
| Runtime / hosting | **One Cloudflare Worker with static assets** (SPA + API), Workers Free |
| Dev/build | Vite + `@cloudflare/vite-plugin` (runs the Worker in workerd inside `vite dev`) + `wrangler` |
| API framework | Hono (+ `hono/secure-headers`, typed client via `hono/client`) |
| Database | Cloudflare D1 (SQLite), hand-written SQL migrations in `migrations/`, no ORM |
| Validation | zod (shared request/response schemas in `src/shared/schemas/`) |
| UI | React 19, React Router 7 (library mode, lazy routes), TanStack Query 5 |
| Styling | Tailwind CSS 4, logical-property utilities only (`ms-*`, `pe-*`, `start-*`, `text-start`) |
| Primitives | Radix UI (`@radix-ui/react-dialog`, `-dropdown-menu`, `-toast`, `-tabs`) |
| Charts | Recharts, loaded only in lazy route chunks |
| i18n | i18next + react-i18next (ICU-free; built-in `Intl.PluralRules` plurals) |
| Font | `@fontsource-variable/heebo` self-hosted (Latin + Hebrew, tabular numerals) |
| Auth | Passkeys: `@simplewebauthn/server` + `@simplewebauthn/browser` |
| Spreadsheet parsing | SheetJS CE `xlsx` **0.20.3 from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`** (browser only, lazy chunk, with `cpexcel.full.mjs` codepages); Papa Parse for CSV |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`) |
| Icons | `lucide-react`; app icons rendered from `assets/icon.svg` by `scripts/gen-icons.mjs` (uses `sharp`) |
| Tests | Vitest (node project for `src/shared`, `@cloudflare/vitest-pool-workers` project for API+D1), Playwright |
| Lint | ESLint flat config + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-i18next` (no literal strings) + custom restricted-import rules (§6) |
| Email (optional) | Resend HTTP API, only if `RESEND_API_KEY` is set |

If `cdn.sheetjs.com` is unreachable during the run: install `xlsx@0.18.5` from npm, record it in
`DECISIONS.md` and `PROGRESS.md` as a TODO (it is only ever used client-side on the user's own
file), and continue.

No date library: dates are `YYYY-MM-DD` strings handled by `src/shared/dates.ts` (UTC math);
"today" is computed in the household timezone with `Intl.DateTimeFormat('en-CA', {timeZone})`.

### 4.2 Platform limits designed for (Workers Free / D1 Free)
Confirmed via Cloudflare docs search on 2026-11-14: 100,000 Worker requests/day; **10 ms CPU
per invocation**; 50 subrequests and **50 D1 queries per invocation**; D1 500 MB per database,
5 GB per account; static-asset requests are free and unmetered; Workers AI 10,000 neurons/day
free on every plan; limits reset 00:00 UTC. From prior knowledge, not re-verified this session:
D1 Free 5 M rows read/day and 100 k rows written/day; 100 bound parameters per D1 statement;
3 MB compressed Worker size; 5 cron triggers per account.

Design consequences (binding rules):
- **No heavy CPU in the Worker.** Spreadsheets are parsed in the browser. Aggregations are done
  in SQL (D1 time is not Worker CPU), never by looping rows in JS. Import requests carry
  ≤ 250 rows each and are validated with a hand-written loop, not zod-per-row.
- **≤ 20 D1 queries per request** by convention; group reads with `db.batch()`.
- Bulk insert uses one statement per chunk: `INSERT … SELECT … FROM json_each(?2)` (one bound
  JSON parameter), so the 100-parameter limit is irrelevant.
- Indexes so that list/aggregate queries read only one household's rows for the date range.
- Capacity sanity: a household is ~150–400 rows/month; a dashboard load reads < 5 k rows. Fifty
  households stay far below every daily limit.

### 4.3 Repo layout
```
/PLAN.md /REFERENCE.md /DECISIONS.md /PROGRESS.md /README.md
/wrangler.jsonc  /vite.config.ts  /tsconfig*.json  /eslint.config.js  /playwright.config.ts
/migrations/0001_init.sql …            # applied by `wrangler d1 migrations apply`
/public/_headers  /public/icons/*      # static headers + generated icons
/assets/icon.svg
/src/shared/        # isomorphic, pure, no I/O
  app.ts money.ts dates.ts normalize.ts
  schemas/*.ts      # zod request/response
  domain/ ledger.ts budget.ts recurring.ts forecast.ts goals.ts health.ts insights.ts review.ts
  import/ sniff.ts grid.ts registry.ts otsar.ts generic.ts dedupe.ts types.ts
  i18n/ en.json he.json keys.ts
/src/server/
  index.ts          # Hono app, exports default { fetch, scheduled }
  env.ts middleware/ (session, csrf, household, role, rateLimit, errors, headers)
  db/ tenant.ts global.ts tables.ts sql/*.ts     # the ONLY place that touches env.DB
  routes/ auth.ts admin.ts household.ts accounts.ts categories.ts rules.ts transactions.ts
          imports.ts budgets.ts recurring.ts planned.ts forecast.ts goals.ts health.ts
          trends.ts dashboard.ts reviews.ts ai.ts
  ai/ provider.ts workersAi.ts openaiCompatible.ts mock.ts prompts.ts limits.ts
  seed/ defaults.ts demo.ts
/src/client/
  main.tsx app.tsx routes.tsx api.ts i18n.ts
  components/ (ui primitives, Money, DateText, ExplainSheet, charts/…)
  features/<feature>/…      # one folder per route group
  import/ (worker.ts parse pipeline UI glue)
/tests/unit/**      # node vitest: shared domain + parsers
/tests/api/**       # workers-pool vitest: routes + isolation
/e2e/**             # Playwright
/fixtures/otsar-hahayal/synthetic/*   # generated, committed
/fixtures/otsar-hahayal/private/*     # real files, GITIGNORED
/scripts/ gen-icons.mjs gen-fixtures.mjs deploy.sh smoke.mjs admin-recovery.mjs seed-local.mjs
```

### 4.4 Runtime shape
- `wrangler.jsonc`: `main: src/server/index.ts`; `assets: { binding: "ASSETS",
  not_found_handling: "single-page-application", run_worker_first: ["/api/*"] }`;
  `d1_databases: [{ binding: "DB", database_name: "maazan", migrations_dir: "migrations" }]`;
  `ai: { binding: "AI" }`; `triggers.crons: ["17 2 * * *"]`; `observability.enabled: true`;
  `preview_urls: false`; `compatibility_flags: ["nodejs_compat"]`; current compatibility date.
  Vars: `APP_HOST` (empty in dev), `DEFAULT_LOCALE="en"`, `AI_PROVIDER="workers-ai"`,
  `AI_MODEL`, `AI_GLOBAL_DAILY_CALLS="150"`. Secrets: §17.
- All API under `/api`, JSON only, `Cache-Control: no-store`. Errors:
  `{ "error": { "code": "snake_case", "message": "dev-facing English", "details"?: {} } }` —
  the client maps `code` to `errors.<code>` in the catalog (fallback `errors.unknown`).
- Middleware order: request id → security headers → error handler → body-size guard (1.5 MB) →
  rate limit (auth routes) → CSRF (non-GET) → session → household → role → route.
- Cron (daily): delete expired sessions, challenges, invites > 30 days past expiry, old
  rate-limit rows, `ai_usage` older than 90 days.
- Logging: one line per request `{rid, method, routePattern, status, ms, userId?}`. Never log
  bodies, query strings, descriptions, amounts, tokens.

---

## 5. Data model (D1)

Conventions: ids are 21-char nanoid text; timestamps ISO-8601 UTC text; dates `YYYY-MM-DD`;
months `YYYY-MM`; money = **signed integer minor units** (`*_minor`, agorot; income positive,
spending negative); booleans 0/1. Every tenant table has `household_id TEXT NOT NULL
REFERENCES households(id)` as the **first column of its main index**. `PRAGMA foreign_keys` is
on in D1; use `ON DELETE CASCADE` from child rows to their parent within a household.

### 5.1 Global tables (not tenant-scoped; accessed only via `db/global.ts`)
```sql
users(id PK, display_name NOT NULL, email, is_super_admin DEFAULT 0, locale, theme,
      created_at, last_login_at)
passkeys(id PK, user_id FK, credential_id UNIQUE, public_key BLOB, counter INT, transports,
         device_label, created_at, last_used_at)
auth_challenges(id PK, challenge, purpose /*register|login*/, invite_id, expires_at)
sessions(token_hash PK, user_id FK, active_household_id, created_at, last_seen_at,
         expires_at, absolute_expires_at, user_agent)
households(id PK, name, currency DEFAULT 'ILS', timezone DEFAULT 'Asia/Jerusalem',
           status DEFAULT 'active' /*active|disabled*/, has_sample_data DEFAULT 0,
           ai_enabled DEFAULT 0, ai_consent_at, ai_consent_by, ai_consent_provider,
           safety_buffer_minor DEFAULT 0, forecast_daily_variable_minor /*NULL = auto*/,
           created_at, created_by)
memberships(household_id, user_id, role /*owner|member|viewer*/, created_at,
            PRIMARY KEY(household_id, user_id))
invites(id PK, token_hash UNIQUE, kind /*bootstrap|owner|member|recovery*/, household_id,
        role, target_user_id, note, created_by, created_at, expires_at, used_at, used_by,
        revoked_at)
rate_limits(key, window_start, count, PRIMARY KEY(key, window_start))
```

### 5.2 Tenant tables (accessed only via `db/tenant.ts`)
```sql
accounts(id PK, household_id, name, type /*checking|savings|cash|credit_card*/, institution,
         account_mask /*last 4 digits max*/, opening_balance_minor DEFAULT 0, opening_date,
         include_in_forecast, is_liquid, archived DEFAULT 0, created_at)
account_balances(id PK, household_id, account_id FK, date, balance_minor,
                 source /*import|manual*/, import_id, UNIQUE(account_id, date))
categories(id PK, household_id, name, kind /*income|expense|transfer*/,
           grp /*fixed|variable|NULL*/, is_debt DEFAULT 0, system_key /*NULL or e.g. 'card_unsplit'*/,
           icon, color, sort, archived DEFAULT 0, UNIQUE(household_id, name))
category_rules(id PK, household_id, field /*description|operation_type*/,
               match /*contains|equals|starts_with*/, pattern_norm, sign /*any|in|out*/,
               category_id FK, source /*user|learned|ai|seed*/, hits DEFAULT 0, created_at,
               UNIQUE(household_id, field, match, pattern_norm, sign))
imports(id PK, household_id, account_id FK, parser_id, file_name, file_hash, period_start,
        period_end, rows_total, rows_inserted, rows_duplicate, rows_merged, rows_error,
        status /*open|committed|undone*/, created_by, created_at)
import_profiles(id PK, household_id, account_id FK, header_signature, mapping_json, updated_at,
                UNIQUE(account_id, header_signature))
transactions(id PK, household_id, account_id FK, date, value_date, amount_minor,
             description, description_norm, reference, operation_type,
             category_id, category_source /*user|rule|ai|NULL*/, has_splits DEFAULT 0,
             kind DEFAULT 'normal' /*normal|card_lump*/, notes,
             recurring_id, recurring_due, planned_id, import_id, dedupe_key,
             balance_after_minor, source /*import|manual*/, created_by, created_at, updated_at,
             UNIQUE(household_id, account_id, dedupe_key))
  INDEX tx_h_date(household_id, date); INDEX tx_h_cat_date(household_id, category_id, date);
  INDEX tx_h_import(household_id, import_id); INDEX tx_h_rec(household_id, recurring_id, recurring_due)
transaction_splits(id PK, household_id, transaction_id FK CASCADE, category_id, amount_minor, note)
budgets(id PK, household_id, category_id FK, effective_from /*YYYY-MM*/, limit_minor,
        UNIQUE(household_id, category_id, effective_from))
recurring_items(id PK, household_id, name, kind /*expense|income|card_charge*/,
                amount_minor /*signed*/, amount_mode /*fixed|estimated*/,
                cadence /*weekly|monthly|bimonthly|quarterly|yearly*/, day_of_month,
                anchor_date, start_date, end_date, account_id, category_id, match_norm,
                status /*active|paused|suggested|dismissed*/, source /*user|detected|seed*/, created_at)
recurring_overrides(id PK, household_id, recurring_id FK CASCADE, due_date, amount_minor,
                    skipped DEFAULT 0, UNIQUE(recurring_id, due_date))
planned_expenses(id PK, household_id, name, amount_minor /*signed*/, date, category_id,
                 account_id, card_recurring_id /*NULL = paid from account*/,
                 status /*planned|done|cancelled*/, matched_tx_id, notes, created_at)
goals(id PK, household_id, name, description, target_minor, start_minor DEFAULT 0, start_date,
      target_date, priority, status /*active|completed|archived*/, created_at)
goal_contributions(id PK, household_id, goal_id FK CASCADE, date, amount_minor, note, transaction_id)
reviews(id PK, household_id, month, status /*draft|completed*/, snapshot_json, ai_json,
        health_score, completed_at, completed_by, UNIQUE(household_id, month))
ai_usage(household_id, day, feature /*categorize|review*/, calls, tokens_in, tokens_out,
         PRIMARY KEY(household_id, day, feature))
audit_log(id PK, household_id, user_id, action, entity, entity_id, meta_json, created_at)
```
A view supplies "effective lines" (the unit for all category math):
```sql
CREATE VIEW v_lines AS
SELECT t.household_id, t.id tx_id, NULL split_id, t.account_id, t.date, t.amount_minor,
       t.category_id, t.kind, t.recurring_id, t.planned_id
  FROM transactions t WHERE t.has_splits = 0
UNION ALL
SELECT t.household_id, t.id, s.id, t.account_id, t.date, s.amount_minor,
       s.category_id, t.kind, t.recurring_id, t.planned_id
  FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id;
```
`src/server/db/tables.ts` exports `TENANT_TABLES` (name + delete order). It drives household
reset/delete **and** the isolation tests; a test asserts that every table in `sqlite_master`
with a `household_id` column is in the registry.

### 5.3 Default categories (created per household in the creator's locale; names editable)
Income: Salary · Benefits & allowances · Other income.
Expense/fixed: Rent · Mortgage (`is_debt`) · Loans (`is_debt`) · Municipal tax & utilities ·
Phone & internet · Insurance · Education & childcare · Subscriptions · Bank fees.
Expense/variable: Groceries · Eating out · Transport & fuel · Car · Health · Clothing · Home ·
Leisure · Kids · Gifts & donations · Travel · Cash withdrawals · **Credit card (not split)**
(`system_key='card_unsplit'`) · Other.
Transfer: Internal transfers · Savings & investments.
Seed rules (`source='seed'`, ~40): Israeli payees/operation types → category, e.g. משכורת →
Salary; ביטוח לאומי → Benefits; ארנונה / חברת החשמל / מי- / תאגיד מים / גז → utilities; בזק /
פרטנר / סלקום / הוט / פלאפון → phone; שופרסל / רמי לוי / ויקטורי / יוחננוף → groceries; פז / דלק /
סונול / רב קו → transport; מכבי / כללית / מאוחדת / סופר-פארם → health; עמלה / דמי ניהול → bank
fees; משכנתא → mortgage; הלוואה → loans; משיכת מזומן / כספומט → cash.
Card-issuer patterns (flag `kind='card_lump'`, category `card_unsplit`): ישראכרט, isracard, כאל,
cal, מקס, max it, לאומי קארד, ויזה, visa, מסטרקארד, mastercard, אמריקן אקספרס, amex, דיינרס,
diners, כרטיסי אשראי — only when the amount is negative.

---

## 6. Tenancy & isolation (central enforcement)

1. `householdMiddleware` resolves `householdId` **only** from `session.active_household_id`,
   verified against `memberships` on every request. No route accepts a household id from the
   URL, body or headers. (`POST /api/session/household` switches the active household after
   checking membership.) A disabled household → 403 `household_disabled`.
2. `db/tenant.ts` exports `tenantDb(env.DB, householdId)` with:
   - `q.all/first/run(sql, ...params)` — `?1` is always bound to `householdId`; the helper
     **throws** unless the SQL text contains `household_id = ?1`; route code passes params
     from `?2` on. Every joined tenant table must repeat `AND x.household_id = ?1`.
   - `q.insert(table, row)` — sets `household_id` itself; rejects a row that carries one.
   - `q.owns(table, id)` / `q.assertOwned({accounts:[…], categories:[…]})` — every foreign id
     arriving in a payload is checked before use; failure → 404 `not_found`.
   - `q.batch([...])` for grouped statements with the same guarantees.
3. ESLint `no-restricted-syntax`/`no-restricted-imports`: `env.DB`, `D1Database` and
   `db/global.ts` may be referenced only under `src/server/db/**`, `src/server/routes/auth.ts`,
   `src/server/routes/admin.ts`, `src/server/middleware/**`, `src/server/seed/**`. A unit test
   greps the source tree for violations too.
4. Admin routes use `db/global.ts` functions that return **metadata only** (names, counts,
   dates); there is no admin function that selects from a tenant table except
   `COUNT(*)`/`MAX(created_at)` per household.
5. Roles: `owner` > `member` > `viewer`. `roleMiddleware` default: GET needs viewer, other
   methods need member; routes marked `owner` (members, invites, AI consent, reset/delete)
   need owner.

---

## 7. Auth flows

Passkeys (WebAuthn) only; accounts are created exclusively through single-use links.
- **Links** carry the token in the URL **fragment** (`/invite#<token>`, `/setup#<token>`,
  `/recover#<token>`) so it never reaches server logs or `Referer`. The page reads it and sends
  it in a POST body.
- **RP ID** = request hostname; expected origin = request origin. If var `APP_HOST` is set,
  auth ceremonies on any other host are rejected (400 `wrong_host`). RP name = `APP_NAME`.
- **Register** (`POST /api/auth/register/options {token, displayName}` → options;
  `…/verify {token, response}`): `attestation: 'none'`, `residentKey: 'required'`,
  `userVerification: 'preferred'`, algorithms ES256 + RS256. On verify, in one batch: create
  user (unless `recovery`, which targets an existing user), store passkey, mark invite used,
  create membership (owner/member invites) or household + membership + default categories
  (bootstrap), create session. Bootstrap token is the `BOOTSTRAP_TOKEN` secret, compared in
  constant time, valid only while `users` has no super-admin.
- **Login** (`POST /api/auth/login/options` → challenge with empty `allowCredentials`;
  `…/verify`): look up credential, verify, bump counter (reject if counter regresses and is
  non-zero), create session with `active_household_id` = most recently used membership.
- **Existing user invited to another household**: `/invite#token` while signed in →
  `POST /api/invites/accept {token}`.
- **Add passkey** (signed in) and **list/remove passkeys** (cannot remove the last one).
- **Session**: 32 random bytes, base64url, cookie `__Host-mz_session`; DB stores SHA-256.
  `last_seen_at`/`expires_at` are refreshed at most once per hour (saves D1 writes).
- **CSRF**: SameSite=Lax cookie **and** every non-GET must have `Origin` equal to the request
  origin **and** header `X-MZ: 1` **and** `Content-Type: application/json`; otherwise 403
  `csrf`. GET handlers never mutate.
- **Rate limits** (D1 `rate_limits`, keyed by `CF-Connecting-IP` + route group): auth routes
  20 requests / 5 min; token failures 5 / 15 min → 429 `rate_limited`.
- **Optional email**: if `RESEND_API_KEY` and `EMAIL_FROM` are set, creating an invite with an
  email address also sends the link by email. Without them the UI offers Copy and the native
  share sheet (`navigator.share`). No other email use.
- iOS note for the UI copy: the invite is opened in Safari, the passkey is saved to iCloud
  Keychain, then the user adds the app to the Home Screen and signs in there with the same
  passkey (Home-Screen apps have separate cookies).

---

## 8. API surface

All tenant routes are implicitly scoped to the active household. `→` shows the main response.

```
GET  /api/health                       → {ok, version, db}
Auth:   POST /api/auth/register/options|verify · POST /api/auth/login/options|verify
        POST /api/auth/logout · POST /api/auth/logout-all
        GET/POST/DELETE /api/auth/passkeys[/:id]
        GET  /api/me                   → {user, households[], active, role, features:{ai}}
        PATCH /api/me {locale?, theme?, displayName?} · POST /api/session/household {id}
        POST /api/invites/inspect {token} → {kind, householdName?, role?}  (no session)
        POST /api/invites/accept {token}
Admin (super-admin): GET/POST /api/admin/households · PATCH /api/admin/households/:id {status|name}
        POST /api/admin/households/:id/owner-invite · POST /api/admin/users/:id/recovery
Household (owner for writes): GET/PATCH /api/household (name, currency, timezone, buffer,
        forecast_daily_variable) · GET /api/household/members · PATCH/DELETE …/members/:userId
        GET/POST /api/household/invites · DELETE …/invites/:id · POST …/members/:userId/recovery
        POST /api/household/sample-data · POST /api/household/reset · DELETE /api/household
Accounts:   GET/POST /api/accounts · PATCH/DELETE /api/accounts/:id · POST /api/accounts/:id/balance
Categories: GET/POST /api/categories · PATCH/DELETE /api/categories/:id
Rules:      GET/POST /api/rules · PATCH/DELETE /api/rules/:id · POST /api/rules/apply
Transactions: GET /api/transactions?from&to&account&category&uncategorized&q&cursor
        POST /api/transactions · PATCH/DELETE /api/transactions/:id
        PUT /api/transactions/:id/splits · GET /api/transactions/:id/split-suggestion
        POST /api/transactions/bulk {ids[], categoryId} · POST /api/transactions/undo-learn {ruleId}
        GET /api/transactions/export.csv?…
Imports:    POST /api/imports/preview {accountId, rows[≤250]}
        POST /api/imports {accountId, parserId, fileName, fileHash, period} → {importId}
        POST /api/imports/:id/rows {rows[≤250]} · POST /api/imports/:id/commit {closingBalance?}
        GET /api/imports · DELETE /api/imports/:id (undo)
        GET/PUT /api/import-profiles?accountId
Budgets:    GET /api/budgets?month → BudgetView · PUT /api/budgets {month, items[{categoryId, limitMinor|null}]}
Recurring:  GET/POST /api/recurring · PATCH/DELETE /api/recurring/:id · POST /api/recurring/detect
        PUT /api/recurring/:id/overrides/:dueDate {amountMinor?, skipped?}
        GET /api/upcoming?days=45
Planned:    GET/POST /api/planned · PATCH/DELETE /api/planned/:id
Forecast:   GET /api/forecast → ForecastView (§10.3)
Goals:      GET/POST /api/goals · PATCH/DELETE /api/goals/:id · POST/DELETE /api/goals/:id/contributions[/:cid]
Health:     GET /api/health-score?months=6
Trends:     GET /api/trends/categories?month · /api/trends/daily?month · /api/trends/monthly?months=12&category?
Dashboard:  GET /api/dashboard → {month, asOf, pnl, forecast, budget, upcoming, goals, health, insights}
Reviews:    GET /api/reviews · GET /api/reviews/:month (draft built on the fly) · POST /api/reviews/:month/complete
AI:         GET /api/ai/status → {available, enabled, provider, model, trainsOnInputs, usageToday, limits}
        POST /api/ai/consent {enabled} (owner) · POST /api/ai/categorize → {suggestions[]}
        POST /api/ai/categorize/apply {items[]} · POST /api/ai/review/:month → {headline, commentary{}}
```
Request/response zod schemas live in `src/shared/schemas/` and are the single source of the
client types.

---

## 9. Import pipeline

### 9.1 Client stages (`src/shared/import/*`, pure; UI in `src/client/features/import`)
1. **Validate & sniff** (`sniff.ts`): size ≤ 5 MB; extension ∈ {xlsx, xls, csv}; magic bytes:
   `50 4B 03 04` → xlsx; `D0 CF 11 E0` → xls (BIFF); otherwise decode as text: if it starts
   (after BOM/whitespace) with `<` and contains `<table` → html-table; else csv. Mismatch of
   extension and content is allowed (banks do this); unknown binary → `unsupported_file`.
2. **Decode text**: UTF-8 BOM → UTF-8; UTF-16 BOM → UTF-16; else try `new TextDecoder('utf-8',
   {fatal:true})`; on failure `TextDecoder('windows-1255')`.
3. **To grid** (`grid.ts`): SheetJS `read(data, {type:'array', cellDates:false, raw:true,
   codepage:1255})` for xlsx/xls/html → first sheet with ≥ 2 non-empty rows →
   `sheet_to_json(ws, {header:1, raw:true, defval:null, blankrows:true})`. CSV → Papa Parse
   (`delimiter` auto among `,` `;` tab; `skipEmptyLines:false`). Result `Cell[][]`
   (`string|number|null`). Strings are stripped of bidi marks (U+200E/F, U+202A–E, U+2066–9),
   NBSP → space, trimmed.
4. **Pick parser** (`registry.ts`): each `BankParser { id, labelKey, detect(grid) → 0..1,
   parse(grid) → ParseResult }`. Highest score ≥ 0.6 wins; else the generic mapper.
5. **Parse → `ParseResult`**: `{ rows: NormRow[], errors: RowError[], period?, accountMask?,
   closingBalance?: {date, minor}, warnings: string[] }` with
   `NormRow { row, date, valueDate?, amountMinor, description, reference?, operationType?,
   balanceMinor?: number|null, occ }`.
6. **Occurrence index**: after parsing, rows with an identical `(date, amountMinor,
   norm(reference), norm(description))` tuple get `occ = 1, 2, …` in file order (chronological
   order — reverse first if the file is newest-first).
7. **Upload**: preview in chunks of 250; on confirm `POST /api/imports`, then
   `…/rows` chunks, then `…/commit`.

### 9.2 Otsar Ha-Hayal parser (`otsar.ts`, id `otsar-hahayal`)
- Header row = first row in rows 1–30 containing ≥ 5 of: `יתרה`, `תאריך ערך`, `זכות`, `חובה`,
  `תיאור`, `אסמכתא`, `סוג פעולה`, `תאריך` (after `norm`). Column positions come from that row —
  never hard-coded. `detect` = matched headers / 8.
- Metadata above the header: period from a cell matching `מתאריך … עד תאריך …` (two dates);
  account mask = last 4 digits of the longest digit run in the account row — nothing else of
  the account number is kept in memory after parsing.
- Row parsing: date cell → number = Excel serial (`date = 1899-12-30 + n days`, 1900 system),
  string → `dd/MM/yyyy` | `dd.MM.yyyy` | `dd/MM/yy` | ISO. Amount = credit − debit (each
  parsed by `parseAmount`: numbers as is; strings: remove `₪`, spaces, thousands commas; `(x)`
  and trailing `-` → negative). Exactly one of credit/debit must be non-zero, else
  `amount_invalid`. Description trimmed and inner whitespace collapsed. Rows without a date →
  skipped silently if entirely empty or a totals row (no date **and** no reference), else
  error `date_invalid`.
- Balance: `0` or empty is "missing" when another row of the same date has a non-zero balance
  or when 0 is inconsistent with the continuity check; `closingBalance` = last present balance
  of the latest date.
- Continuity check: across consecutive present balances, `bal_k = bal_j + Σ amounts(j..k]`;
  if it fails with the file order, retry reversed; if both fail add warning
  `balance_mismatch` (non-blocking).
- **TODO marker**: if no real file exists in `fixtures/otsar-hahayal/private/`, leave
  `// TODO(otsar-real-file): verified only against synthetic fixtures built from REFERENCE.md §18`
  at the top of `otsar.ts` and say so in `PROGRESS.md`.

### 9.3 Generic mapper (`generic.ts`, id `generic`)
- Header row guess: first row in 1–40 with ≥ 3 non-empty string cells, followed by ≥ 2 rows
  where ≥ 2 of the same columns are non-empty.
- Column guess by synonym sets (normalized, he + en): date {תאריך, תאריך עסקה, date}; value
  date {תאריך ערך, value date}; description {תיאור, פרטים, תיאור פעולה, שם בית עסק,
  description, details, payee}; debit {חובה, debit, withdrawal}; credit {זכות, credit,
  deposit}; amount {סכום, amount, סכום חיוב}; balance {יתרה, balance}; reference {אסמכתא,
  reference, ref}; type {סוג פעולה, סוג, type}.
- Date format auto-detect over the first 20 values (serial numbers; `dd/MM/yyyy`, `dd.MM.yy`,
  `yyyy-MM-dd`; `MM/dd/yyyy` only if dd/MM is impossible), user-overridable.
- Mapping UI: one row per target field with a column picker + live 5-row preview; "amounts
  are positive for spending" toggle for single-amount files. Valid when date + description +
  (amount | debit+credit) are mapped. Saved to `import_profiles` keyed by
  `header_signature` = `norm` of header cells joined by `|`.

### 9.4 Server (`routes/imports.ts`)
- Fast structural validation per row (types, date regex, `|amountMinor| ≤ 10^11`, description
  ≤ 300 chars, `occ` 1–99).
- `dedupe_key = "v1|" + date + "|" + amountMinor + "|" + norm(reference) + "|" +
  normKey(description) + "|" + occ`. Manual transactions use `"m|" + id`.
- **Preview** classifies each row: `new`; `duplicate` (key exists for the account);
  `matches_manual` (a manual, non-imported transaction on the same account with the same
  amount within ±3 days and not already merged — default action merge: the manual row adopts
  the imported fields and key, keeps its category/notes/splits); and returns the rule-suggested
  category and `kind`.
- **Commit** recomputes everything (never trusts preview): `INSERT … SELECT FROM json_each
  … ON CONFLICT(household_id, account_id, dedupe_key) DO NOTHING`, counts via `changes()`;
  then one pass each (SQL-driven): apply rules to the import's uncategorized rows; flag card
  lumps; link recurring occurrences and planned expenses (§10.2); upsert `account_balances`
  (import closing balance); run detection; write `audit_log('import.commit')`.
- **Undo**: delete transactions with that `import_id` (splits cascade), delete its balance
  snapshot, set status `undone`. Rows merged into manual entries revert to manual.

### 9.5 Text normalization (`normalize.ts`)
`norm(s)`: NFKC → remove niqqud/cantillation (U+0591–U+05C7) → remove bidi marks → unify
quotes (`״ ” “ „` → `"`, `׳ ’ ‘` → `'`) → collapse whitespace → trim → lowercase.
`normKey(s)` = `norm(s)` with digit runs of ≥ 4 removed and whitespace re-collapsed (used for
dedupe, rule patterns and recurring grouping).

### 9.6 Categorization rules
A rule matches when `sign` fits and `field` value (`normKey(description)` or
`norm(operation_type)`) satisfies `match` against `pattern_norm`. Order: source user > learned
> ai > seed; then longer pattern first; first match wins. Learned rule from a manual
categorization: `field=description, match=equals, pattern=normKey(description), sign` = the
transaction's sign. Rules never overwrite `category_source='user'`.

---

## 10. Domain algorithms (`src/shared/domain`, pure functions, fully unit-tested)

### 10.1 Common definitions (define once, use everywhere)
- **Line**: a row of `v_lines`. **Transfer line**: category kind = transfer. All P&L math
  ignores transfer lines.
- **Income(period)** = Σ amount of lines with category kind income, plus uncategorized lines
  with amount > 0. **Expenses(period)** = −Σ amount of lines with category kind expense, plus
  uncategorized lines with amount < 0 (so a refund in an expense category reduces expenses).
  **Net** = Income − Expenses. **Savings rate** = Net / Income (undefined if Income ≤ 0).
- Cash basis: a line belongs to the month of its `date`. A card lump belongs to the month it
  is charged.
- **T** = today in the household timezone. **Current month** = month of T.
- **Account balance at date D** = balance of the latest `account_balances` snapshot with
  date ≤ D, plus Σ amounts of that account's transactions with snapshot date < date ≤ D; with
  no snapshot: `opening_balance` + Σ transactions with `opening_date` ≤ date ≤ D.
  **Variance** (accounts page) = latest snapshot balance − (opening + Σ all transactions up to
  that date); shown only when an opening balance was entered.
- **As-of date A** = the latest date among balance snapshots and imported transactions of the
  forecast accounts, capped at T; if the household has no imports and no snapshots, A = T.
  **Stale** = T − A > 35 days.
- **Complete months before M**: calendar months earlier than M that contain at least one
  transaction; "last 3 complete months" = the up-to-3 most recent of them that are < month(A)
  or fully covered (month end ≤ A).

### 10.2 Recurring: detection, occurrences, settlement
**Occurrences** of an active item in `[from, to]`: monthly family → every `k` months
(k = 1, 2, 3, 12) counted from the anchor month, on `min(day_of_month, daysInMonth)`;
weekly → every 7 days from `anchor_date`. Bounded by `start_date`/`end_date`. No shifting for
weekends/holidays. An occurrence with override `skipped=1` is dropped; with override amount,
that amount is used.

**Expected amount** of an occurrence: override amount → else for `estimated` items the mean of
the last ≤ 3 settled occurrences' actual amounts (if none, `amount_minor`) → else
`amount_minor`.

**Settlement**: a transaction settles occurrence `(item, due)` when `recurring_id = item.id`
and `recurring_due = due`. Linking pass (after import and after manual add), for each
transaction without `recurring_id`, for each active item in creation order: same sign;
`account_id` equal when the item has one; `normKey(description)` contains `match_norm`
(card_charge items with empty `match_norm` match `kind='card_lump'` on their account); amount
within tolerance (fixed ±10 %, estimated ±40 %, card_charge any); and some unsettled
occurrence with `|date − due| ≤ 10` days → link to the nearest such occurrence. Users can link
or unlink by hand from the transaction sheet.

**Detection** (creates `suggested` items; skips patterns that already have an item in any
status including dismissed): take transactions of the last 6 months, not transfers; group by
`(account_id, sign, normKey(description))`; card lumps group by `(account_id, 'card_lump',
normKey(description))`. A group is a candidate when:
- it appears in ≥ 3 distinct months, **or** in 2 consecutive months with amounts within 2 %;
- in ≥ 80 % of its months it appears exactly once;
- day-of-month spread (max − min, circular within a 31-day month) ≤ 6;
- for non-card groups `(max − min) / median(|amount|) ≤ 0.25`.
Result: `day_of_month` = median day; `amount_minor` = median amount; `amount_mode` = fixed if
relative spread ≤ 0.02 else estimated; kind = card_charge for lump groups, income for positive
sign, else expense; cadence monthly (bi-monthly when present only in alternating months, ≥ 3
occurrences); `match_norm` = the group key; category = most common category in the group.

**Totals**: monthly cost = Σ over active expense/card items of `|expected| × factor`
(weekly 52/12, monthly 1, bimonthly 1/2, quarterly 1/3, yearly 1/12); yearly = × 12.

### 10.3 Forecast (end-of-month balance and lowest point)
Inputs: T, A, forecast accounts (`include_in_forecast=1`, not archived), their transactions,
active recurring items + overrides, planned expenses, household settings.
Horizon: `E` = last day of the month after the current month. `EOM` = last day of the current
month.

1. **Start**: `bal[A] = Σ account balance at A` over forecast accounts (§10.1).
2. **Known events after A**: manual transactions on forecast accounts dated in `(A, E]` are
   applied on their dates as actuals (they may settle occurrences/planned items).
3. **Recurring events**: every unsettled, unskipped occurrence of active items (whose account
   is a forecast account or null) with due date in `(A, E]`, at its expected amount, on its due
   date. Unsettled occurrences due in `[A − 5 days, A]` are assumed late and scheduled on
   `A + 1`. Unsettled occurrences older than that are **missed**: excluded and returned in
   `missed[]` for the UI.
4. **Planned events**: status `planned`, paid from an account: date in `(A, E]` → on its date;
   date in `[A − 5, A]` → on `A + 1`; older → `overdue[]`, excluded. Paid by card
   (`card_recurring_id`): the amount is added to that card item's first occurrence with due
   date > planned date, **unless** that occurrence has an override amount (the override is the
   user's full figure). Planned income (positive amounts) is handled the same way.
5. **Variable-spend estimate**: `baselineDaily` = household `forecast_daily_variable_minor` if
   set; else `V / D` where V = Σ |amount| of expense lines on forecast accounts in the last 3
   complete months that are not transfers, not card lumps, have no `recurring_id` and no
   `planned_id`, and D = number of days in those months. If there is no complete month but the
   month of A has ≥ 10 days of data: the same sum over that month up to A ÷ days elapsed.
   Otherwise 0 and `lowConfidence = true`. For each day d in `(A, E]`:
   `var[d] = max(0, baselineDaily − manualVariableOutflow[d])` where the second term is the
   sum of manual, non-recurring, non-planned expense actuals on day d.
   Unlinked income is never forecast (conservative).
6. **Series**: for d = A+1 … E: `bal[d] = bal[d−1] + actuals[d] + recurring[d] + planned[d] − var[d]`
   (all in integer agorot; `baselineDaily` is rounded to an integer once).
7. **Outputs** (`ForecastView`): `asOf`, `stale`, `startBalance`, `series[{date, balance}]`
   from A to E, `eom {date, balance}`, `low {date, balance}` = minimum of `bal[d]` for d in
   `[T, EOM]` (ties → earliest; if A = T and nothing happens, it is today's balance),
   `lowHorizon` (same over `[T, E]`), `afterNextCard {date, balance}` = balance on the due
   date of the next card_charge occurrence after T (null if none), `belowZero`, `belowBuffer`
   (low < `safety_buffer_minor`), `breakdown` for `(A, EOM]`: `{income, recurring, card,
   planned, variable, actuals}` with `startBalance + Σ breakdown = eom.balance` exactly,
   `events[]` (date, label, amount, type), `missed[]`, `overdue[]`, `confidence`.
8. **Confidence**: `high` = not stale, A ≥ T − 7 days and ≥ 3 complete months; `low` = stale,
   or no complete month, or no forecast account; else `medium`.
9. **Month P&L "expected"** (dashboard): expected expenses = actual expenses of the current
   month up to A + |negative recurring + card + planned events| in `(A, EOM]` + Σ var over
   `(A, EOM]`; expected income = actual + positive events in `(A, EOM]`.

Edge cases to test: no forecast accounts (view with `confidence: low`, empty series, UI empty
state); A in a previous month; A = T; February/day-31 clamping; occurrence due on A (settled vs
not); override amount; skipped occurrence; planned-by-card with and without override; planned
overdue; estimated item with 0, 1, 3, 5 settled charges; negative start balance; manual
transaction after A larger than the daily baseline; year boundary (December → January).

### 10.4 Budget
- `limit(category, M)` = `limit_minor` of the budget row with the greatest
  `effective_from ≤ M`; none or NULL → unbudgeted. Only expense categories are budgeted.
- `spent(category, M)` = −Σ amount of the category's lines dated in M (may be negative after
  refunds; display floor 0, math unfloored).
- `f` (elapsed fraction): past month → 1; current month → `day(min(T, A)) / daysInMonth` when
  A is in the current month, else "no data yet" (statuses not computed); future month → 0.
- Utilization `u = spent / limit` (limit 0: u = ∞ when spent > 0, else 0).
  Status: **over** if `spent > limit`; else **watch** if the category is `variable` and
  (`u ≥ 0.9`, or `u ≥ 0.5 and u > f + 0.10`); else **on_pace**. Bar colour: red / amber / green.
- Totals over budgeted categories: `budgeted = Σ limit`, `spentBudgeted = Σ spent`,
  `pctSpent = spentBudgeted / budgeted`, pace sentence: ahead when `pctSpent > f + 0.05`,
  under when `< f − 0.05`, else on pace. `unbudgetedSpent` = expenses in categories without a
  limit, listed as its own row. Split by group: fixed vs variable sub-totals.
- `avg3(category)` = mean monthly spent over the last 3 complete months.
- Allocation: `budgeted` vs mean monthly income of the last 3 complete months.
- `unsplitCard(M)` = Σ |amount| of `card_lump` transactions in M with `has_splits = 0`.

### 10.5 Goals
- `saved = start_minor + Σ contributions`. `progress = clamp(saved / target, 0, 1)`.
- `remaining = max(0, target − saved)`.
- With a target date: `monthsLeft = max(1, ceil(daysBetween(T, target_date) / 30.4375))`,
  `requiredMonthly = ceil(remaining / monthsLeft)`;
  `expectedByNow = target × clamp((T − start_date) / (target_date − start_date), 0, 1)`
  (if `target_date ≤ start_date` → `target`).
- Status: **completed** if `saved ≥ target`; else, with a target date, **on_track** if
  `saved ≥ expectedByNow − 0.05 × target`, otherwise **behind** (always behind when
  `target_date < T`); without a target date **no_deadline** (excluded from the goal sub-score).
- `pace` = mean monthly contributions over the last 3 full months; projected finish =
  T + `remaining / pace` months (null when pace ≤ 0).
- Capital allocation: `surplus` = mean monthly Net of the last 3 complete months;
  `committed` = Σ requiredMonthly of active dated goals; `pctAllocated = committed / surplus`
  (surplus ≤ 0 → flag "no surplus").
- Milestones: 25 / 50 / 75 / 100 % reached when `progress` crosses them; the date is the date
  of the contribution that crossed it.

### 10.6 Health score
Window for month M: M and the two months before it, restricted to complete months (1–3).
`lerp` between consecutive breakpoints; clamp outside.

| Sub-score | Weight | Input | Breakpoints (input → points) |
|---|---|---|---|
| Savings | 25 | `s` = Net / Income over the window | −0.10→0 · 0→30 · 0.10→65 · 0.20→90 · 0.30→100 |
| Debt load | 20 | `d` = debt payments / Income over the window; debt payments = expenses in `is_debt` categories | 0→100 · 0.15→90 · 0.30→65 · 0.36→50 · 0.50→15 · 0.60→0 |
| Safety cushion | 25 | `r` = liquid funds / mean monthly Expenses; liquid = Σ max(0, balance at end of M) of `is_liquid` accounts | 0→0 · 1→25 · 3→70 · 6→100 |
| Budget adherence | 15 | `b` = budgeted categories with spent ≤ limit / budgeted categories, month M | 0→0 · 0.5→40 · 0.8→80 · 1→100 |
| Goal progress | 15 | `g` = on_track or completed dated goals / dated active goals, as of end of M | 0→0 · 1→100 |

Null rules: Savings and Debt are null when Income ≤ 0 (Savings = 0 instead when Income ≤ 0 but
Expenses > 0); Cushion is null when there is no liquid account or Expenses = 0; Budget is null
with no budgeted category; Goals is null with no dated active goal.
`overall = round(Σ wᵢ·scoreᵢ / Σ wᵢ)` over non-null sub-scores; null if fewer than 2.
Labels (overall and each sub-score): ≥ 85 excellent · 70–84 good · 50–69 fair · < 50 needs
attention. Trend = overall for each of the last 6 months (computed on the fly as of each
month's end). Change = this month − previous month.

Recommendations — evaluate each counterfactual, recompute `overall`, keep gains ≥ 0.5, sort
descending, show top 3 (each with the ₪ figure):
1. Spend less: monthly expenses reduced by 5 % of income (affects Savings and Cushion input).
2. Bring every over-limit category back to its limit (Budget adherence = 1; the ₪ total over).
3. Add one month of expenses to liquid funds (r + 1).
4. Put every behind goal back on track (g = 1; ₪ = Σ extra monthly needed).
5. Reduce debt payments by 10 %.

### 10.7 Action items (`insights.ts`) — all rule-based
Each item: `{id, severity: info|warn|alert|good, key, params, href}`. Order: alert, warn, info,
good; max 8 on the dashboard.
- `stale_data` (warn): stale → Import. · `no_forecast_account` (info).
- `low_point_negative` (alert): `low.balance < 0`; `low_point_buffer` (warn): below buffer.
- `uncategorized` (warn): count > 0 in the last 60 days → ledger filter.
- `card_unsplit` (info): `unsplitCard(displayMonth) > 0`.
- `budget_over` (warn): one per over category, max 3, then "+N more".
- `category_spike` (info): category spent ≥ 1.3 × avg3 and ≥ ₪200 above it (complete-month
  comparison; for the current month compare pro-rated: `spent / f`, only when f ≥ 0.5).
- `pace_vs_last_month` (info/good): expenses to date vs previous month to the same day, when
  the difference is ≥ 10 %.
- `recurring_suggested` (info): suggested items waiting.
- `payment_soon` (info): any single upcoming item ≥ ₪1,000 within 7 days.
- `goal_behind` (warn): per behind goal, max 2. · `goal_milestone` (good).
- `savings_good` (good): last complete month savings rate ≥ 20 %.
- `under_budget` (good): last complete month `spentBudgeted ≤ budgeted`.

### 10.8 Monthly review (`review.ts`)
`buildReview(month)` returns a language-neutral snapshot; text is rendered on the client from
catalog keys + params, so it works in both locales. Chapters:
1. **Summary** — health score + change, Income / Expenses / Net, 3–4 headline bullets (top
   insights by severity), celebration chips (score up ≥ 3, milestone reached, under budget).
2. **Income** — total, change vs previous month, by category with % share.
3. **Spending** — total, change, vs budget, by category (amount, %), **notable transactions**:
   expense transactions ≥ max(₪500, 3 × the median expense of the month), top 5.
4. **Budget** — adherence (on/under ÷ budgeted), per-category spent / limit / over-by.
5. **Goals** — totals, per goal progress, required monthly, milestones reached this month.
6. **Cash flow & upcoming** — savings rate, forecast EOM + low point (when reviewing the
   latest month), next 5 upcoming items.
7. **Wrap-up** — headline (by score label and change), wins (good insights), watch list
   (warn/alert insights), next steps (top recommendations from §10.6 as numbered actions).
Each chapter carries `commentary: {key, params}` chosen by rules (e.g. spending up/down/flat
vs previous month × over/under budget). Default review month: last complete month.
Completing stores `snapshot_json` (and `ai_json` if generated) and the score.

---

## 11. AI integration

### 11.1 Provider comparison (checked 2026-11-14; free tiers change — re-check before relying)
| | Cloudflare Workers AI | Groq (free) | Google Gemini API (free) |
|---|---|---|---|
| Free allowance | 10,000 neurons/day per account, all models share it; on Workers Free requests simply fail once it is used (no bill) | Per-model limits, roughly 30 req/min and 1,000–14,400 req/day; token/day caps (e.g. ~200k for the largest models) | Flash / Flash-Lite only; per-model quotas no longer published (shown in AI Studio); third-party reports of very low daily request counts since late 2025 |
| Quality | Good open models (70B–120B class); Hebrew acceptable, not great | Same class of open models, very fast | Best Hebrew of the three |
| Trains on inputs? | **No** (customer content not used for training) | **No** per its services agreement; default retention is described inconsistently in its own docs; Zero Data Retention can be switched on in the console | **Yes — free-tier content may be used to improve Google products** |
| Extra account / key | None (binding in the same Worker) | Yes | Yes |

**Decision:** default provider = **Workers AI** (no key, no extra account, does not train on
inputs, hard-capped at $0). Second adapter = generic **OpenAI-compatible** (used for Groq:
base URL `https://api.groq.com/openai/v1`). Gemini is not offered as a preset; it can be
reached through the OpenAI-compatible adapter only by an explicit operator choice, and then
the consent sheet states that the provider trains on inputs (`AI_TRAINS_ON_INPUTS=true`).

Model: `AI_MODEL` var. During M9 run `npx wrangler ai models --json` (if credentials exist)
and pick the first available of: `@cf/openai/gpt-oss-120b`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
`@cf/zai-org/glm-4.7-flash`, then any current ≥ 20B instruct model that does not require a
paid plan; record the choice in `DECISIONS.md`. Without credentials, default to
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Budget: a review call is ≈ 2k tokens in / 600 out
≈ 150–200 neurons on a 70B model, so the 150 calls/day global cap fits in 10,000 neurons only
on average-sized calls — keep `max_tokens` ≤ 700 and treat a provider quota error as
`ai_unavailable`.

### 11.2 Interface (`src/server/ai/provider.ts`)
```ts
interface AiProvider {
  id: 'workers-ai' | 'openai-compatible' | 'mock';
  info: { label: string; model: string; trainsOnInputs: boolean; note: string };
  generateJson<T>(req: { system: string; user: string; schema: z.ZodType<T>;
                         maxTokens: number; temperature: number }): Promise<{ data: T;
                         tokensIn: number; tokensOut: number }>;
}
getProvider(env): AiProvider | null   // null when AI_PROVIDER = 'none' or misconfigured
```
`generateJson`: asks for JSON only, 20 s timeout (`AbortController`), extracts the first JSON
object from the text, validates with zod, retries once on invalid output, then throws
`AiError('ai_bad_output' | 'ai_unavailable' | 'ai_timeout')`. `mock` returns deterministic
canned output derived from the request (used by tests and e2e via `.dev.vars`).

### 11.3 Features
- **Categorize**: up to 40 distinct `normKey(description)` values of uncategorized,
  non-transfer transactions (operation types of person-to-person transfers are excluded so
  people's names are never sent). Payload item: `{i, text, dir: 'in'|'out', amount: rounded to
  ₪10}` after scrubbing (digit runs ≥ 5 removed, e-mail addresses removed, max 60 chars), plus
  the household's category names. Output `[{i, category, confidence}]`; unknown names are
  dropped. Shown as suggestions; "Apply" sets `category_source='ai'` and creates rules with
  `source='ai'`.
- **Review commentary**: input = the review snapshot reduced to aggregates: totals, category
  names with amounts and shares, budget lines, goal names with progress, score and sub-scores,
  insight keys; **no** transaction descriptions, notes, references, account names or member
  names. Output `{headline, commentary: {summary, income, spending, budget, goals, cashflow,
  wrapup}}` in the requesting user's locale (the system prompt names the language), ≤ 60 words
  each, no advice to buy/sell financial products. Rendered with an "AI-written" tag and the
  "general information, not financial advice" line.
- Gate for every AI route: provider available → household `ai_enabled` → usage limits
  (`ai_usage` upsert-and-check, plus the global sum for the day) → call. Failures return a
  typed error; the client keeps the rule-based content.
- Prompts live in `ai/prompts.ts`; payload builders are pure functions in `src/shared` and
  snapshot-tested with fixtures containing a canary phone number, account number, e-mail and
  person name that must not appear in the output.

---

## 12. i18n & RTL

- Catalogs `src/shared/i18n/en.json` (source of keys) and `he.json`; nested keys by feature
  (`nav.*`, `ledger.*`, `errors.*`, `insights.*`, `review.*`). **Both ship in the MVP and both
  are complete at the end of every milestone** (unit test: identical key sets, identical
  interpolation variables, no empty values).
- Locale resolution: `users.locale` → `localStorage.mz_locale` → first of `navigator.languages`
  matching `he` or `en` → `DEFAULT_LOCALE` (`en`). Switch in Settings and on the sign-in page.
- `<html lang dir>` set from the locale (`he` → `rtl`). CSS uses logical properties only; a
  lint check (stylelint is not needed: an ESLint/grep test) fails on `ml-`, `mr-`, `pl-`, `pr-`,
  `left-`, `right-`, `text-left`, `text-right`, `border-l`, `border-r`, `rounded-l`, `rounded-r`
  Tailwind classes and on `left:`/`right:` in CSS files.
- `<Money>` and `<DateText>` components are the only way to print amounts/dates:
  `Intl.NumberFormat(locale, {style:'currency', currency})` (2 decimals in the ledger, 0 on
  dashboard cards) wrapped in `<bdi>`; `Intl.DateTimeFormat`; `he-IL` / `en-IL` locales so both
  show `dd/MM/yyyy` and ₪. Month names from `Intl`. Tabular numerals (`font-variant-numeric`).
- Bank text (descriptions, notes) renders with `dir="auto"`.
- Charts: time axis always oldest → newest left to right; tooltips/legends follow text
  direction. Chevrons/back arrows mirror in RTL (`rtl:-scale-x-100`); trend arrows do not.
- Plurals via i18next suffixes (`_one`, `_two`, `_many`, `_other`); Hebrew copy uses
  gender-neutral phrasing (infinitive/plural). Hebrew labels follow REFERENCE.md §17's glossary
  (our own wording). English labels: Overview, Transactions, Budget, Recurring, Upcoming,
  Accounts, Goals, Trends, Monthly review, Forecast, Settings, Household; Income / Spending /
  Left over; Health score; Savings rate; Debt load; Safety cushion; Budget adherence; Goal
  progress; On track / Behind; Fixed / Variable; Uncategorized.
- Default category and seed data names exist in both locales (`seed/defaults.ts`).

---

## 13. PWA & iPhone

- `index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1,
  viewport-fit=cover">`, `apple-mobile-web-app-capable=yes`, `mobile-web-app-capable=yes`,
  `apple-mobile-web-app-status-bar-style=default`, `theme-color` (light + dark media),
  `apple-touch-icon` 180 px.
- Manifest: `name`/`short_name` Maazan, `display: standalone`, `start_url: /`, `scope: /`,
  `background_color`, `theme_color`, icons 192, 512, 512 maskable, `lang`, `dir: auto`.
- Service worker (Workbox generateSW): precache the build; navigation fallback to
  `/index.html` **with denylist `/^\/api\//`**; `/api/*` → `NetworkOnly`; `registerType:
  'prompt'` with an "Update available — reload" toast. No tenant data in Cache Storage,
  `localStorage` (only `mz_locale`, `mz_theme`, dismissed-hint flags) or IndexedDB.
- Layout: `min-height: 100dvh`; bottom tab bar (Overview, Transactions, Budget, Upcoming,
  More) fixed with `padding-bottom: env(safe-area-inset-bottom)`; header padded with
  `safe-area-inset-top`; ≥ 1024 px: start-side sidebar instead of the tab bar. Forms open as
  bottom sheets on mobile (Radix Dialog styled as a sheet), centered dialogs on desktop.
- Touch: targets ≥ 44×44 px; inputs/selects font-size 16 px; amount fields
  `inputmode="decimal"`; `overscroll-behavior-y: contain` on the scroll container; no hover-only
  affordances; `:active` feedback.
- File input: `accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"`
  (extensions + MIME so iOS Files does not grey out files); drag & drop zone on desktop.
- Install hint: in iOS Safari (not standalone) show a one-time dismissible card "Share → Add
  to Home Screen". Offline: the shell loads and shows an "You're offline" state with retry.
- Visual design: original — calm neutral surfaces, one teal accent, green/amber/red semantic
  colours with icons (never colour alone), light + dark + system. Do not imitate the reference.

---

## 14. Seed & demo data

`src/server/seed/demo.ts` — deterministic generator (seeded PRNG, e.g. mulberry32 with a fixed
seed) producing data **relative to today**, in the requesting user's locale:
- Accounts: "Checking" (forecast, liquid, masked `1234`), "Savings" (liquid, not forecast),
  card item "Credit card" charged on the 10th.
- 6 full months + the current month up to yesterday: salary ×2 (1st and 10th), child
  allowance (20th), rent (1st), municipal tax (bi-monthly), electricity, water, phone,
  internet, insurance, 3 subscriptions, daycare, loan repayment, ATM withdrawals, bank fees,
  bit-style transfers, a monthly card lump (₪6–9k) **split** into groceries / eating out /
  fuel / leisure / clothing / health for past months and **unsplit** for the latest one, a few
  uncategorized rows, one refund, one large one-off.
- Budgets for 12 categories (two slightly over, one at ~90 %), 3 goals (emergency fund on
  track, vacation behind, car no deadline) with contributions, 2 planned expenses (car test
  next week from account; flights next month by card), confirmed recurring items + 1
  suggested, a completed review for the previous month, balance snapshot as of yesterday.
- Sets `households.has_sample_data = 1`; "Clear sample data" = household reset.
Used by: `POST /api/household/sample-data` (empty households only), `npm run seed:local`, and
the e2e global setup. The generator inserts through the same tenant helpers as the app.

Synthetic bank fixtures (`scripts/gen-fixtures.mjs`, output committed under
`fixtures/otsar-hahayal/synthetic/`): `otsar_2026-10.xlsx` (exact REFERENCE.md §18 layout:
rows 1–4 metadata, row 5 empty, row 6 headers in B–I, serial dates, padded descriptions, `0`
balance on all but the last row of each day, ~60 rows incl. a card lump, salary, standing
orders, two identical same-day rows); `otsar_2026-10-15_2026-11-14.xlsx` (overlaps the first);
`otsar_2026-10.xls` (BIFF); `otsar_shifted_header.xlsx` (header on row 9); `generic_bank.csv`
(windows-1255, different Hebrew headers, single signed amount, `dd.MM.yy`);
`html_table.xls` (HTML table saved as .xls); `broken.xlsx` (bad dates/amounts for the error
report). All data invented; fake account number.

---

## 15. Testing strategy

Scripts: `npm run typecheck`, `lint`, `test:unit`, `test:api`, `test:e2e`, and
**`npm run verify`** = typecheck + lint + unit + api + build + e2e. `verify` must be green at
the end of every milestone.

### 15.1 Unit (Vitest, node) — `tests/unit`
- `money`, `dates` (month ends, leap years, timezone "today"), `normalize` (niqqud, quotes,
  bidi marks, digits).
- Parsers: every synthetic fixture → expected row counts, amounts, dates, period, closing
  balance, error codes; shifted header; reversed order; zero-balance handling; windows-1255
  detection; HTML-in-xls; generic header/column/date-format guessing. If files exist in
  `fixtures/otsar-hahayal/private/`, a conditional test (`describe.runIf`) parses each and
  asserts: parser id `otsar-hahayal`, rows > 0, zero errors, no `balance_mismatch` — and
  prints nothing from the file.
- `dedupe` (occurrence index, overlap, re-import), rules (precedence, learning).
- `budget`, `recurring` (occurrences, detection thresholds on both sides, settlement),
  `forecast` (every edge case in §10.3 + the exact-sum invariant + AC7.2), `goals`, `health`
  (each breakpoint, interpolation midpoints, null/renormalization, recommendations),
  `insights`, `review` (snapshot of the demo household for a fixed date).
- i18n key parity; no-physical-direction-classes check; restricted-import check; AI payload
  PII canary.

### 15.2 API (Vitest + `@cloudflare/vitest-pool-workers`, real D1 with migrations applied)
Per route group: happy path, validation errors, role matrix (owner/member/viewer/anonymous),
CSRF rejections, body-size and row-count limits. Auth: challenge lifecycle, token single-use
and expiry, bootstrap closes after first use, session expiry and rolling, logout-all. WebAuthn
verification itself is exercised in e2e; API tests use a test-only helper that inserts a
session row directly (the helper lives in `tests/`, not in `src/`).

### 15.3 Isolation suite (`tests/api/isolation.test.ts`) — mandatory
- Fixture: households A and B, each loaded with demo data; every text field of B additionally
  contains the marker `ZZ-B-CANARY`.
- **Enumerate** all registered routes from the Hono app (`app.routes`). For each tenant route:
  as a member of A, call it with B's ids substituted for every `:id` and every id-typed body
  field → expect 404 (or 400 for malformed), never 200/204; then assert B's rows are
  unchanged (row counts + checksum per tenant table).
- As A, call every GET route (with A's ids and with no ids) and assert the canary never
  appears in any response body.
- Assert `TENANT_TABLES` covers every table that has a `household_id` column; assert
  `tenantDb().all()` throws on SQL lacking `household_id = ?1`.
- Admin endpoints as super-admin: responses contain no amounts, descriptions or the canary.
- A route added later without a test entry fails the suite (the enumeration requires each
  route to be classified `public | auth | admin | tenant` in a table in the test).

### 15.4 E2E (Playwright) — `e2e/`
Config: `webServer` builds and runs the app locally on a fresh local D1 (`wrangler dev` or
`vite preview` per the Cloudflare plugin) with `.dev.vars` (`BOOTSTRAP_TOKEN=e2e-bootstrap`,
`AI_PROVIDER=mock`). Project **`iphone`**: `devices['iPhone 15']` with `browserName:
'chromium'` (needed for the CDP virtual authenticator: `WebAuthn.enable` +
`addVirtualAuthenticator {protocol:'ctap2', transport:'internal', hasResidentKey:true,
hasUserVerification:true, isUserVerified:true, automaticPresenceSimulation:true}`). Project
`desktop` (1280×800) runs the smoke subset. Never run `playwright install`; use the
preinstalled Chromium (`/opt/pw-browsers/chromium` if a pinned version mismatches); `--trace
off`. Selectors: roles and `data-testid`, never translated text (except the i18n test).

Specs (in order; serial where they share state):
1. `setup.spec` — `/setup#e2e-bootstrap` → name → passkey → onboarding. Second attempt fails.
2. `auth.spec` — sign out, passkey sign-in, session persists on reload; unauthenticated
   deep link redirects to sign-in and back.
3. `import.spec` — choose `otsar_2026-10.xlsx` through the file chooser → preview counts match
   the fixture → commit → ledger shows rows, dashboard shows October numbers; re-upload same
   file → "0 new, N duplicates"; upload the overlapping file → only new rows; `broken.xlsx` →
   error report listed and downloadable; `generic_bank.csv` → mapping screen → commit.
4. `ledger.spec` — add a manual transaction; categorize one → toast "N more categorized";
   split the card lump; filter state survives reload (URL).
5. `forecast.spec` — read EOM value; add a planned expense of ₪1,234 before month end → EOM
   lower by exactly ₪1,234; set a card-charge override → value changes accordingly; open "How
   is this calculated?" and check the rows sum to the figure.
6. `budget-goals.spec` — set a budget inline, status colour changes; add a goal and a
   contribution, progress updates.
7. `review-ai.spec` — AI disabled: all 7 chapters render, AI button shows the enable hint,
   complete the review, it appears in history. Enable AI through the consent sheet (asserts
   provider/model/"what is sent" present) → "Write commentary with AI" → AI-tagged text
   appears (mock). Disable again → control returns to hint.
8. `household.spec` — owner creates a member invite → second browser context registers via
   the link → sees the same data; viewer role cannot see write controls; super-admin creates a
   second household + owner invite → third context sees an empty household and none of the
   first one's data.
9. `i18n-layout.spec` — for `en` and `he`, for every main route: no horizontal overflow, tab
   bar visible, `dir` correct; in `he` a known label is Hebrew; screenshots written to
   `e2e/screenshots/<locale>/<route>.png` (gitignored) — **open and look at them**.
10. `pwa.spec` — manifest served with required fields, service worker registered, `/api/me`
    not cached, safe-area CSS present.

### 15.5 Deployed smoke (`scripts/smoke.mjs <baseUrl>`) — no credentials needed
`GET /api/health` 200 `{ok:true, db:true}`; `GET /` 200 HTML with the manifest link;
`GET /manifest.webmanifest` 200 JSON; `GET /api/me` 401; `POST /api/transactions` without
session 401 or 403; `POST /api/auth/login/options` 200 with a challenge; security headers
present on `/` and `/api/health`; `GET /api/does-not-exist` 404 JSON; deep link `/budget`
returns the SPA shell. Exit code non-zero on any failure.

---

## 16. Milestones (in order; each ends green on `npm run verify`, committed, `PROGRESS.md` updated)

**M0 — Scaffold.** Vite + Cloudflare plugin + Hono `/api/health` (checks D1), wrangler config,
migrations runner, Tailwind, ESLint (incl. custom rules), Vitest projects, Playwright projects
with one trivial e2e, `npm run verify`, `.gitignore` (`.env*`, `.dev.vars`, `.wrangler`,
`fixtures/**/private/`, `e2e/screenshots`, `dist`), `README.md`, `DECISIONS.md`, `PROGRESS.md`.
*Done when:* dev server serves the SPA and `/api/health`; verify green.

**M1 — Shell, i18n, PWA.** Layout (tab bar / sidebar), routes with placeholder pages, theme,
`en` + `he` catalogs and switcher, `Money`/`DateText`, ExplainSheet, toasts, sheets, manifest,
icons, service worker, install hint, `_headers`, parity/direction tests, `i18n-layout` and
`pwa` e2e. *Done when:* AC2.1–2.5.

**M2 — Auth & tenancy.** Migration for global tables, sessions, CSRF, rate limit, passkey
register/login, bootstrap, invites (owner/member/recovery), household switcher, members UI,
admin UI, `tenantDb`, table registry, isolation harness (with the routes that exist), cron
cleanup, `admin-recovery.mjs`. *Done when:* AC1.1–1.9; `setup`, `auth`, `household` e2e.

**M3 — Accounts, categories, rules, ledger.** Tenant migration (all tenant tables at once, to
avoid later churn), defaults + seed rules, accounts, categories, rules, transactions CRUD,
search/filters, learned rules, splits, bulk, CSV export, first version of the demo generator
(accounts + transactions) and `seed:local`. *Done when:* AC3.1–3.7; `ledger` e2e.

**M4 — Import.** Fixture generator, sniff/decode/grid, Otsar parser, generic mapper + profile,
preview, chunked commit, dedupe, merge with manual, error report, history + undo, card-lump
flagging, balance snapshots. *Done when:* AC4.1–4.9; `import` e2e.

**M5 — Budgets & trends.** Budget domain + page, pace, allocation, unsplit banner, trends
endpoints + page with charts. *Done when:* AC5.1–5.5, AC10.1.

**M6 — Recurring, planned, forecast.** Recurring CRUD, occurrences, settlement linking,
detection, overrides, upcoming list, planned expenses, forecast domain + endpoint + card +
chart + explain sheet. *Done when:* AC6.1–6.6, AC7.1–7.4; `forecast` e2e.

**M7 — Goals, health score, dashboard, action items.** *Done when:* AC8.x, AC9.x, AC11.x;
`budget-goals` e2e. Demo generator completed (AC14.1) and onboarding card.

**M8 — Monthly review (rule-based).** Snapshot builder, chapter UI, complete + history.
*Done when:* AC12.1–12.2.

**M9 — AI.** Provider interface, Workers AI + OpenAI-compatible + mock adapters, consent,
limits, categorize suggestions, review commentary, status endpoint, settings UI.
*Done when:* AC12.3, AC13.1–13.4; `review-ai` e2e.

**M10 — Hardening & polish.** Reset/delete household (AC15.1), passkey management, sessions
list, empty/loading/error states on every page, a11y pass (labels, focus traps, contrast),
bundle check (initial JS ≤ 250 kB gzip; SheetJS and Recharts only in lazy chunks), security
checklist walk-through (§18) with each item ticked in `PROGRESS.md`, full isolation suite over
all routes, review screenshots in both locales and fix layout defects.

**M11 — Deploy.** `scripts/deploy.sh`, `scripts/smoke.mjs`, README runbook. If credentials are
present: deploy, smoke, record the URL. Final summary.

Time guidance: if the run is behind after M6, simplify in this order (and log it): trends
"category over 12 months" chart → goal milestones → recommendations point-gain (keep the
list) → generic-mapper profile saving. Never skip: isolation suite, import dedupe, forecast
tests, AI-off path, both locales.

---

## 17. Deployment

Secrets (Wrangler secrets only; local values in `.dev.vars`, deploy-time values read from the
environment or `.env.local`, both gitignored):
| Name | Required | Purpose |
|---|---|---|
| `BOOTSTRAP_TOKEN` | yes | One-time super-admin setup link. `deploy.sh` generates 32 random bytes if absent and prints the setup URL once |
| `AI_API_KEY` | only for `AI_PROVIDER=openai-compatible` | e.g. Groq key |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Invite emails |
Deploy-time environment (never stored in the Worker): `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`.

`scripts/deploy.sh` (idempotent, `set -euo pipefail`, loads `.env.local` if present):
1. Fail with a clear message if the two Cloudflare variables are missing.
2. `npm ci && npm run typecheck && npm run test:unit && npm run test:api`.
3. Ensure D1: `npx wrangler d1 list --json`; create `maazan` if absent
   (`npx wrangler d1 create maazan`); write its `database_id` into `wrangler.jsonc` (an id,
   not a secret).
4. `npx wrangler d1 migrations apply maazan --remote`.
5. `npm run build && npx wrangler deploy`; capture the `*.workers.dev` URL.
6. Secrets via `npx wrangler secret put` (only those not already set — check
   `wrangler secret list`): `BOOTSTRAP_TOKEN` (generated on first deploy), optional ones if
   present in the environment.
7. If `APP_HOST` var is empty, set it to the deployed hostname in `wrangler.jsonc` and deploy
   once more (locks WebAuthn to that host).
8. `node scripts/smoke.mjs https://<host>`.
9. Print: URL, and on first deploy the setup link `https://<host>/setup#<BOOTSTRAP_TOKEN>`
   (printed to the terminal only — never written to a committed file or `PROGRESS.md`).

`npm run deploy` = `bash scripts/deploy.sh`. Local: `npm run dev` (applies local migrations
first), `npm run seed:local`. Rollback: `npx wrangler rollback`. Custom domain later: add a
route/custom domain, update `APP_HOST`; existing passkeys are bound to the old host, so issue
recovery links (documented in README).

---

## 18. Security checklist (tick each in `PROGRESS.md` during M10)

- [ ] Secrets only in Wrangler secrets / `.dev.vars` / `.env.local`; all three patterns
      gitignored; `git grep` for token-like strings before each commit; no secrets in
      `wrangler.jsonc` vars.
- [ ] **This repository is public**: no real bank file, real account number, or real
      transaction ever committed; `fixtures/**/private/` gitignored and covered by a test that
      fails if a file under it is tracked by git.
- [ ] No request bodies, descriptions, amounts, tokens or cookies in logs; error responses
      carry codes, not stack traces.
- [ ] Session: `__Host-` cookie, HttpOnly, Secure, SameSite=Lax; token hashed at rest; rolling
      + absolute expiry; logout and logout-all; sessions invalidated when a membership is
      removed (active household cleared).
- [ ] CSRF: Origin check + custom header + JSON content type on every non-GET; no state change
      on GET.
- [ ] WebAuthn: challenge single-use with 5-minute expiry; origin and RP ID verified; counter
      checked; tokens in URL fragments only.
- [ ] Tokens (invite/recovery/bootstrap): 256-bit, hashed, single-use, expiring, constant-time
      compare; rate-limited.
- [ ] Authorization: every tenant route behind session + household + role middleware; ids from
      payloads verified with `assertOwned`; isolation suite green over all routes.
- [ ] Input: zod on every body/query; body ≤ 1.5 MB; ≤ 250 rows per import request; ≤ 5,000
      rows per import; string length caps; file ≤ 5 MB and type-sniffed client-side; parsing
      in a try/catch that reports `unsupported_file`.
- [ ] SQL: bound parameters only; no string-built SQL from user input (sort/filter columns
      come from allow-lists).
- [ ] Output: React escaping only, no `dangerouslySetInnerHTML`; AI text rendered as plain
      text; CSV export prefixes cells starting with `= + - @` with `'` (formula injection).
- [ ] Headers on pages (`public/_headers`) and API: CSP `default-src 'self'; script-src
      'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
      connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none';
      base-uri 'self'; form-action 'self'`, HSTS, `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera/mic/geolocation;
      API `Cache-Control: no-store`.
- [ ] Service worker never caches `/api/*`; no tenant data in web storage.
- [ ] AI: off by default; consent recorded; payload builders minimize data and pass the canary
      test; provider keys server-side only; limits enforced server-side.
- [ ] Account number stored as last-4 mask at most; the raw file never uploaded.
- [ ] Super-admin has no access to tenant data; admin responses audited by the isolation suite.
- [ ] Dependencies: `npm audit --omit=dev` reviewed; SheetJS from the official CDN tarball.
- [ ] Destructive actions (reset, delete household, remove member, undo import) need explicit
      confirmation and are written to `audit_log`.

---

## 19. Decisions (and why)

- **D-1 Name: Maazan.** Short, means "balance", distinct from the reference. One constant.
- **D-2 Language.** The request fixes "English UI now, i18n-ready, Hebrew if time permits";
  `REFERENCE.md` §16 says Hebrew-first. Resolution: **both locales are MVP and kept complete at
  every milestone**; `en.json` is the key source; the default follows the device language
  (Hebrew device → Hebrew UI), falling back to `DEFAULT_LOCALE=en`. Changing the fallback to
  Hebrew is a one-variable change. REFERENCE.md §16's rule "`he` is the source locale" is
  superseded by this.
- **D-3 One Worker with static assets instead of Pages + separate Worker.** It is Cloudflare's
  current recommended shape for new full-stack apps, static requests are free, one deploy, one
  origin (needed for `__Host-` cookies and passkeys). Still Cloudflare-only and $0.
- **D-4 Passkeys + shareable invite links; no email dependency.** Cloudflare's own email
  sending to arbitrary recipients requires Workers Paid, and third-party free email needs a
  verified domain the owner may not have. Passkeys work well in iOS Safari and Home-Screen
  apps (iCloud Keychain), are phishing-resistant, and cost nothing. Invite links are shared
  through any messenger. Resend is an optional convenience. Email OTP: Later.
- **D-5 Parse spreadsheets in the browser.** Workers Free allows 10 ms CPU per request —
  not enough for XLSX parsing. Side benefits: the raw file and account number never leave the
  phone, no R2, no upload-size risk.
- **D-6 No ORM; SQL migrations + a tenant-scoped query helper.** Fewer moving parts on D1, and
  the helper is the single choke point that makes isolation enforceable and testable.
- **D-7 Household id only from the session**, never from the client. Cross-tenant ids → 404.
- **D-8 Money as signed integer agorot; single currency per household (ILS default).**
- **D-9 Calendar-month budgeting, cash basis.** A card lump counts in the month it is charged.
  A configurable "month starts on day N" is Later.
- **D-10 Credit card = lump in the bank file.** Flagged `card_lump`, categorized "Credit card
  (not split)", splittable with "same as last time"; forecast through a `card_charge`
  recurring item whose estimate is the mean of the last 3 charges and is overridable per
  occurrence. Planned card purchases roll into the next charge.
- **D-11 Forecast starts from the data-as-of date, not from today**, because data arrives
  monthly. Staleness is shown, never hidden.
- **D-12 Variable spending estimate uses bank-account actuals only** (card spend is covered by
  the card estimate) to avoid double counting.
- **D-13 Health score curves are our own** (§10.6), piecewise-linear and published in the UI.
  Sub-scores without data are excluded and weights renormalized rather than scored 0.
- **D-14 Review text is rendered from keys + params on the client**, so reviews are
  language-independent and AI is purely additive.
- **D-15 AI default: Workers AI**; adapters: Workers AI, OpenAI-compatible (Groq), mock.
  Gemini's free tier is excluded by default because it may train on inputs.
- **D-16 AI categorization gives suggestions that the user applies**; nothing is changed by AI
  silently.
- **D-17 Super-admin sees household metadata only.** Operating the service must not mean
  reading other families' finances.
- **D-18 Users may belong to several households** (schema + switcher); the active one lives in
  the session.
- **D-19 Roles: owner / member / viewer.** Category-level visibility is Later.
- **D-20 Dedupe key includes an occurrence index** so identical same-day transactions survive
  while re-imports stay idempotent. Balance is not part of the key (it is unreliable per §18).
- **D-21 Imports can be undone**; manual entries matching imported rows are merged by default.
- **D-22 Sample data is opt-in per empty household** and removable in one tap; nothing fake is
  mixed into real data.
- **D-23 No offline data.** The shell works offline; financial data is never cached on device.
- **D-24 Hard deletes** for tenant data (privacy over undo); undo exists only for imports and
  learned rules.
- **D-25 E2E runs Chromium with an iPhone device profile** (virtual passkey authenticator needs
  CDP). Real-device Safari check is on the owner's post-run list.
- **D-26 Detection and insights thresholds** are the constants written in §10; they live in
  `src/shared/domain/constants.ts` so they can be tuned in one place.
- **D-27 Timezone Asia/Jerusalem and week start Sunday by default**, per household setting.
- **D-28 Recurring due dates are not shifted for weekends/holidays**; the ±10-day settlement
  window absorbs bank-day shifts.

---

## 20. Later / Dropped

**Later (ordered by value):** card-issuer file import linked to the lump · AI advisor chat ·
bill calendar grid · net worth (property, loans, pension, קרן השתלמות, קופת גמל) and
reconciliation queue · scenarios ("what if") and 6–12-month projections · goal roadmap and
dependencies · weekly/quarterly reviews and a partner summary page · notifications (web push
on iOS Home-Screen apps) · PDF reports · email OTP sign-in · tags and inline table editing ·
audit-trail UI and category-level visibility · configurable budget-month start and overdraft
limit (מסגרת) in the forecast · debt payoff planner · more bank parsers · multi-currency ·
data export/backup of a whole household.

**Dropped:** bank aggregation or credentials of any kind · password / social sign-in ·
portfolio advice · retirement planner · radar chart · command palette · feedback widget.
