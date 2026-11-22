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

## D-R10 · 2026-11-15 · M5 · Budgets & trends
- One server function `computeBudget()` feeds the Budget page, the nav over-budget dot and
  (from M7) the dashboard summary and health score — so the numbers cannot disagree (AC5.4).
- "Spending without a budget" = Expenses(M) per §10.1 (which includes uncategorized outflows)
  minus spending in budgeted categories.
- Budget "history" = last 6 months of total limits vs spending in budgeted categories;
  "distribution" = share of the month's spending by category (CSS bars, tap → filtered ledger).
- Trends "by category" uses accessible CSS bars instead of a chart; "by day" and "over months"
  use Recharts (lazy route chunks only). Charts are wrapped in `dir="ltr"` so time runs
  oldest → newest left to right in both locales.
- ESLint i18n rule runs in `jsx-text-only` mode (array literals inside JSX expressions are
  not user-visible); user-visible attributes (`aria-label`, `title`, `placeholder`, `alt`)
  with letters are blocked by a separate `no-restricted-syntax` selector.

## D-R11 · 2026-11-15 · M6 · Recurring, planned, forecast
- Settlement linking and detection run the pure TS functions (`shared/domain/recurring.ts`) over
  a bounded candidate set (the import's rows, or unlinked rows of the last 120 days after a
  registry change; detection reads one row per transaction of the last 6 months). The writes are
  single set-based `UPDATE … FROM json_each` / bulk inserts. Occurrence generation is not
  expressible in SQL, so this is the one place rows are looped in the Worker; it is linear in
  rows × active items and far below the CPU budget for a household.
- Planned expenses paid from an account are matched to a new transaction on the same account
  with the same sign, amount within 10 % and date within ±7 days (nearest first), then marked
  done and linked both ways. Card-paid planned items are marked done once the first charge of
  that card due after their date has settled. Users can link/unlink by hand (`matchedTxId`).
- "Missed" occurrences are listed when unsettled and due between A − 35 days and A − 5 days.
- `GET /api/upcoming` runs the same forecast engine with the horizon extended to today + 45
  days, so the upcoming list and the forecast always agree; each item carries the projected
  balance at the end of its day.
- Detection compares candidate patterns with existing items by (account, sign, match text), or
  (account, card lump) for card charges, in any status — so dismissed suggestions never return.
- Recurring amounts are entered as positive numbers; the sign follows the kind (income +,
  payment and card charge −).

## D-R12 · 2026-11-15 · M7 · Goals, health, dashboard
- `GET /api/dashboard` reuses `computeBudget`, `forecastFor` and `healthBundle` (same functions
  as the dedicated pages; AC5.4 is asserted by an API test). It issues ≈ 31 D1 statements —
  within the Workers Free limit of 50 per invocation, above the "≤ 20" convention of PLAN §4.2,
  accepted because it replaces 5+ separate page requests. Health liquid balances for all six
  month-ends are computed in a single query.
- Default categories and seed rules are now inserted with two set-based statements (they were
  ~70 single-row inserts, which risked the per-invocation query limit at household creation).
- Health "goal progress" counts dated goals (active or completed) as of each month end;
  recommendation 4's ₪ figure is Σ (required monthly − recent pace) over behind goals.
- `under_budget` uses the last complete month's total spending in budgeted categories vs the
  total of their limits (as §10.7 says), computed inside the health bundle.
- "Clear sample data" = household reset (confirmation sheet; the server still requires the
  household name, which the banner supplies). Reset/delete in Household settings require typing
  the name. Reset keeps `audit_log` and re-seeds default categories/rules.
- Bug fixed: after a successful passkey registration the client re-inspected the spent invite
  link, which counted toward the 5-per-15-minute token-failure limit (found by e2e).

## D-R13 · 2026-11-15 · M8 · Monthly review
- The snapshot stores numbers, category/goal names, notable transaction descriptions and
  catalog keys + params; all prose is rendered on the client, so a stored review reads in
  either language. The AI text (M9) is stored separately in `reviews.ai_json`.
- Review route is `/review?month=YYYY-MM&step=N` (one lazy route; step in the URL).
- A month with no previous-month data reports "about the same" rather than "+0 %".
- Current-month-only insights (pace vs last month) are excluded from reviews of past months.
- The sample household ships a completed review of the previous month; building it adds ~30
  D1 statements to the sample-data request (total ≈ 43, under the Free limit of 50).
- Path params that are not tenant-owned ids (`:month`, `:dueDate`) are excluded from the
  isolation suite's "B id → 404" check; those routes are still covered by the B-unchanged and
  GET-canary checks.

## D-R14 · 2026-11-15 · M9 · AI
- Model: no Cloudflare credentials in this session, so `wrangler ai models` could not be run;
  `AI_MODEL` defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` per PLAN §11.1.
  **Owner check:** run `npx wrangler ai models --json` once deployed and pick the first available
  of `@cf/openai/gpt-oss-120b`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/zai-org/glm-4.7-flash`.
- The Workers AI binding exists only in `env.production` (D-R4). Locally AI is `mock` (tests,
  e2e) or unavailable (plain `npm run dev`).
- Person-to-person transfers are recognised by operation type / description words (העברה, bit,
  ביט, PayBox, Pepper, transfer) and never sent. Digit runs are scrubbed when ≥ 5 digits,
  including dash-grouped numbers (phones, account numbers); e-mails are removed.
- AI review commentary is stored on the review row (`ai_json`, draft or beside a completed
  snapshot) so it survives reloads and is kept when the review is completed; the immutable
  snapshot itself is never changed by AI.
- The AI gate checks provider → household opt-in → limits before any work; a call is reserved
  (counted) before it is made, so failed calls also count toward the daily limits.
- The global daily cap reads the per-day counters of all households through an explicit
  `tenantDb.aiCallsToday()` method (counters only, no tenant content).

## D-R15 · 2026-11-15 · Review fixes (PR #1 review)
- Recovery links issued by an owner are limited to members who are not super-admin and belong to
  no other household (`recovery_needs_admin` otherwise); everyone else is recovered by the
  super-admin, because a recovery passkey grants the whole account.
- One super-admin is enforced by a partial unique index (migration 0005), closing the bootstrap
  race; a losing concurrent setup gets the same 410 as a used link.
- A failed account-creation batch gives the invite back (`used_at` cleared) so the link can be
  retried; an existing member accepting an invite has their role raised (never lowered).
- Card-issuer names match as whole words in Hebrew and Latin; the flag is computed once per row
  on the server and used by both preview and commit.
- Imports never overwrite a manual balance snapshot; undoing an *unfinished* import deletes it
  outright, and the client's cleanup call (`?onlyOpen=1`) can never undo a committed import.
- Undo of a learned categorization restores the rule's previous category/source when the rule
  already existed, instead of deleting it.
- Client: typed confirmations reset on every opening; confirmation errors are shown; the invite
  page waits for the profile before offering registration; ledger filters patch the current URL
  (no stale debounced writes) and empty/invalid periods fall back to the current month.

## D-R16 · 2026-11-15 · Second review fixes (PR #1)
- **Dedupe:** the occurrence index now groups rows by the same text form as the dedupe key
  (`normKey`). Before, two same-day, same-amount rows differing only in a ≥ 4-digit run got one
  key and the second was dropped. (PLAN §9.1.6 said `norm`; §9.4's key is what matters.)
- **Several cards on one account:** detected card items carry the issuer text as `match_norm`
  (one suggestion per issuer); linking picks, among all matching items, the one with the nearest
  free due date, and an item that names its issuer beats a catch-all (empty match) card item.
  A catch-all card item on an account still suppresses further card suggestions there.
- **Import robustness:** over-long cells are capped client-side to the server limits; linking /
  detection failures after the insert no longer leave the import `open`; cleaning up an open
  import that already wrote transactions performs a full undo.
- **Rate limit** applies to `/api/auth/register/*`, `/api/auth/login/*`, `/api/invites/*` only.
- **Recovery** replaces the user's passkeys and ends all their sessions (lost or stolen device).
- **Admin-created households** use the admin's UI language (server fallback `DEFAULT_LOCALE`).
- Invite accept gives the link back if the membership write fails; detected day-of-month uses a
  median that survives a month-end wrap.
- Not changed (known): undoing an import that overwrote another import's same-date balance
  snapshot removes that snapshot; the low-point headline looks only to month end (PLAN §10.3).

## D-R17 · 2026-11-17 · Investment / trading accounts
- New account type `investment` (API + UI). Defaults: not in the forecast, not liquid (not part of
  the safety cushion); both stay user-editable. The value is entered by hand with "Set balance";
  the variance vs. transactions is hidden for these accounts because market moves are expected.
  Money moved in is a transfer ("Savings & investments"), so it never counts as spending.
- **Storage:** rows keep `type = 'savings'` with `is_investment = 1` (migration 0015); the accounts
  route maps both ways. Widening the `CHECK` on `accounts.type` needs a table rebuild, and on D1
  that destroys data: `DROP TABLE accounts` cascades to every child table, `PRAGMA foreign_keys =
  off` is accepted but ignored, `legacy_alter_table` is ignored (a rename retargets child foreign
  keys), and `writable_schema` is not authorized. Verified against workerd's D1. Any SQL that
  needs "investment" must test `is_investment`, not `type`.
- Deferred: live holdings / prices and a net-worth view (PLAN "Later").

## D-R18 · 2026-11-18 · Card split: PDF statements, learned rules, AI
- **PDF statements (Isracard / American Express layout)** are read in the browser with pdf.js
  (lazy chunk + worker, nothing leaves the device). `parseCardPdf` works on positioned text runs:
  a header row with date / business / amount labels defines the columns; values are right-aligned
  under their header (RTL), so a run belongs to the header with the nearest right edge at or past
  its own. The charged amount is the leftmost "סכום" column (installments and foreign purchases
  count at this month's charge). Wrapped business names are joined; digit-only lines (foreign
  reference numbers) are not. Tables end at their "סה"כ" line, which also gives the printed total;
  a mismatch is shown, not hidden. Synthetic fixture: `npm run gen:card-pdf`.
- **Grouping:** uncategorized statement rows are one line per business (normKey); a charge and its
  refund net out and a zero line is dropped.
- **Learning:** saving a split from a statement remembers business → category as rules
  (`POST /api/rules/learn`, opt-out checkbox): `learned`, or `ai` when the AI suggestion was kept.
  A user rule is never re-pointed; payment apps / transfers never become rules (as with "always").
  Learned rules are applied to uncategorized transactions right away.
- **AI:** with AI on, businesses still uncategorized after rules get a suggestion
  (`POST /api/ai/categorize-items`, same scrubbed payload, limits and consent as /categorize).
  Nothing is written until the user saves. PayPal stays a generic payee (never sent, never a rule).
- Known, unrelated: `e2e/05-forecast` "card charge override" fails on main from the 18th of the
  month on (date-dependent), and is left for a separate fix.

## D-R19 · 2026-11-19 · Budget modes: general expenses, occasional categories; split-aware review
- **What:** every expense category has a `budget_mode` (migration 0016): `monthly` (default, as before),
  `general` (pooled: one "General expenses" line with one shared monthly limit in `general_budgets`,
  same recurring / one-time rules as `budgets`) or `occasional` (vacations, gifts: a yearly limit per
  category in `yearly_budgets`, carried to later years until changed). Set on the category's edit sheet;
  system categories stay `monthly`. Catalog defaults: Clothing and Personal care are general, Travel and
  Gifts occasional (new households / newly added only; existing categories are not changed).
- **Where it changes numbers:** Budget (general line with its categories; occasional section with
  year-to-date vs yearly limit, this month and last 12 months; occasional spending is not "spending
  without a budget"); health score (budget adherence via `monthlyBudgetLines`, shared with the budget
  history; occasional spending in the savings rate / surplus replaced by its average over the complete
  months among the last 12); usual month (general pooled; occasional averaged over up to 12 complete
  months); pace insight and the forecast's daily variable baseline exclude occasional spending (it
  belongs in planned expenses); new insight `budget_over_year`. Trends: general is one item (expandable),
  occasional flagged, the months chart stacks everyday + occasional, and a per-quarter card compares
  occasional spending with the year before (`GET /api/trends/occasional`). Totals (Income/Expenses per
  §10.1) are unchanged everywhere: modes regroup and re-time spending, they never hide it.
- **Review:** notable expenses are read from `v_lines`, so a split card charge appears as its lines
  ("Groceries · from Isracard …"); an unsplit card charge is not a purchase and is left out. General
  expenses are one line with their categories; with occasional spending in either month the commentary
  compares everyday spending (`review.c.everyday.*`) and names the occasional amount separately.
  Older stored snapshots render as before (new fields are optional).
- **Name of the pooled line:** chosen by the household language (`GENERAL_NAME`), like default
  category names, so stored review snapshots and insights stay language-neutral data.
- **Rejected:** a hidden system category for the pool (would leak into pickers, rules and the ledger);
  re-interpreting `budgets.limit_minor` as yearly for occasional categories (switching modes would
  silently change the meaning of past rows).

## D-R20 · 2026-11-19 · Card accounts, Apple Pay capture, files shared from the phone (supersedes PLAN D-10 for card accounts)
- **Card accounts:** card-issuer files (Isracard / Amex, Max, Cal) are now imported, into credit-card
  accounts only (`wrong_account_type` otherwise; a hand-mapped generic file may go to either). For a card
  account the file gives every purchase: billed rows at the charged ILS amount; rows not billed yet at
  the transaction amount when it is in shekels (foreign ones wait for the billing file); installment k
  of n dated k − 1 months after the purchase and keyed `ref k/n`, so each month's installment is its own
  row and repeated uploads never drop one (`shared/import/cardAccount.ts`). Rows on a card account are
  never flagged as card lumps.
- **Linking the bank's card charge:** `transactions.card_account_id` (migration 0017). After every write
  that can change it (imports, undo, manual create / edit / delete, captures, account changes)
  `refreshCardPayments` links placeholder card charges (uncategorized or "card not split", never one the
  user split or categorized) to a card account: issuer named in the description (Isracard and Amex as
  one group), then the account's last 4 digits, then the account whose previous-month purchases are
  closest (≤ 10 %); ambiguous → left unlinked. A linked charge is booked by app-owned split lines:
  the bill payment (Internal transfers, not spending) and the part not explained by the card account's
  purchases in the calendar month before the charge ("card not split", still spending — shown as "not
  itemized yet" in the budget banner and the transaction sheet). So totals never lose or double card
  spending: with no card data the charge counts as before, and it shrinks to a transfer as purchases
  arrive. Charges older than the card account's first purchase month aren't linked automatically.
  The user can link / unlink by hand (`PATCH cardAccountId`; null = "not a card bill", stored as
  `'none'` so it is never re-linked); a linked charge can't be split by hand. A card account's balance
  is what it owes: purchases minus linked bill payments.
- **Billing cycle:** "the calendar month before the charge" approximates Israeli cycles (charges on
  the 2nd–15th for the previous month's purchases). Purchases near a cycle edge can show a temporary
  "not itemized" amount until the next charge; totals over two months stay right.
- **Apple Pay capture:** per-user keys (`capture_keys`, SHA-256 at rest, shown once, ≤ 5, revocable;
  viewers get none). `POST /api/hook/purchase` (bearer key, CSRF-exempt because it never uses the
  cookie, rate-limited, failures count toward the token-failure limit) adds a manual row with
  `captured = 1` on the card account matched from Wallet's card name (last 4 digits → issuer → account
  name → the only card account). It goes through rules, recurring linking and the card refresh. Retries
  within 5 minutes are not added twice; foreign-currency purchases are skipped (their ILS amount comes
  with the card file). Captured rows are manual rows, so the existing import merge (same account and
  amount, ± 3 days) replaces them with the file's row, keeping the category; `captured` is cleared on
  merge and restored on undo.
- **Files shared from the phone:** `POST /api/hook/file` (same key) reads an uploaded bank or card file
  on the server (SheetJS loads only for this route; the Worker stays ≈ 0.6 MB compressed), picks the
  account like the import page (mask / bank / the only fitting account) and runs the same commit
  (`commitImport`). Unrecognized layouts or ambiguous accounts are refused with a message to use the
  Import page. This is the one path where a file leaves the device; it is read in memory and never
  stored (the Settings card says so). AC4.2 still holds for the Import page.
- **Setup:** Settings → "Live card tracking": key management and step-by-step Shortcuts instructions
  (Wallet "Transaction" automation, a Share-sheet shortcut). An iCloud shortcut link can't be produced
  from here; the instructions are untested on a device.

## D-R21 · 2026-11-20 · One-tap shortcut install, manual steps as the fallback
- **What iOS allows:** automations can't be shared or imported (each person creates theirs on the
  phone), and since iOS 15 a shortcut installs only from an iCloud link made on an Apple device — a
  server can't produce a signed `.shortcut` file. So the long part moves into a *shortcut* shared by
  iCloud link, and the automation shrinks to "Run Shortcut" with the transaction as input.
- **Household link:** the owner builds each shortcut once (steps in Settings, with an Import Question
  on the key so the shared copy carries none) and pastes its iCloud link (`households.shortcut_*_link`,
  migration 0018; only `https://www.icloud.com/shortcuts/<32 hex>`; owner-only PATCH). Members then see
  "Install the shortcut" (paste your key when asked; creating a key copies it) plus four automation
  steps; the full manual setup stays behind "Didn't work?". Without a link everyone sees the manual
  steps, and the owner sees how to publish one.
- **Tolerant hook:** how the shortcut receives Wallet's transaction isn't documented, so
  `POST /api/hook/purchase` reads our JSON, a Wallet-style dictionary (Merchant / Amount / Card or Pass,
  any case, possibly nested), "Key: value" lines or plain text with an amount (`readPurchase`). Anything
  else → 400 `unreadable_purchase`, whose message points to the manual setup.
- **Not verified on a device:** whether "Request Body: File = Shortcut Input" in the shared shortcut
  sends the transaction in one of those shapes. Community reports also mention Wallet automations
  occasionally passing an empty merchant / 0 amount; those are refused, not stored.

## D-R22 · 2026-11-22 · Friendlier look; subcategories, emoji and colour per category
- **Look:** violet accent, Rubik (rounded, Hebrew + Latin), softer cards (larger radius, layered shadow,
  lighter borders), pill-highlighted tabs. Colour tokens re-picked for both themes; the contrast test
  still holds (≥ 4.5:1 for every text token on bg and surface). The categorical palette is the 8
  validated hues plus a neutral grey (`--mz-cat-other`).
- **Category colour follows the category:** `categories.color` stores a palette slot (`cat-1`…`cat-8`,
  `cat-other`), never a raw colour; without one a stable slot is derived from the id. Charts never
  repaint by rank. On the spending ring, a clash among the shown slices moves the later one to a hue no
  shown category owns; the folded tail ("Other") owns the grey.
- **Donut:** the user asked for it, so the ring is used despite the general preference for bars — kept
  honest by ≤ 5 slices + Other, a legend with names, amounts and shares (identity never by colour
  alone), and a ranked bar list right below it on Trends.
- **Subcategories:** `categories.parent_id`, one level, same kind as the parent, never under a system
  category. `v_lines.category_id` reports a subcategory's lines under its parent and keeps the assigned
  one in `sub_category_id`, so budgets, forecast, health, review, usual month and insights roll up with
  no per-feature code. A subcategory takes its parent's group, debt flag and budget mode (kept in sync
  on every parent change) and has no budget of its own (`subcategory_budget`). Filtering the ledger by a
  parent includes its subcategories; Trends → by category lists each parent with an expandable split
  (the parent's own lines shown as "Parent (directly)"). Archiving / deleting a parent archives its
  subcategories; a category with subcategories can't become one.
- **Known limit:** category names stay unique per household (the existing UNIQUE constraint), so two
  parents can't both have a subcategory called "Other". Rebuilding the table to relax it wasn't worth
  the migration risk now.
- **Emoji:** `categories.emoji`, one emoji checked by `isEmoji` (no zod in the client bundle). Default
  catalog categories get an emoji and colour (also backfilled by name for existing households).

## D-R23 · 2026-11-22 · Pay-day periods
- **What:** `households.period_start_day` (1–28, migration 0020) makes every budget "month" run from
  that day to the day before it next month. One helper, `shared/period.ts` (`Cal`: `of`, `start`, `end`,
  `days`, `dayIn`, `sql`), replaces the calendar-month arithmetic in the money math; day 1 is exactly the
  old behaviour (same SQL), so nothing changes for households that don't set it.
- **Labels:** a period keeps a 'YYYY-MM' label so every month-keyed table (budgets, reviews, yearly
  limits) still works. Start day ≤ 15 → the month it starts in; > 15 → the month it mostly covers
  (25 Oct – 24 Nov is "November"). The UI shows the dates next to the name when the day isn't the 1st.
- **What follows the pay day:** budget (lines, pace, f), Overview, forecast ("month end" = period end,
  horizon = end of the next period, daily baseline over complete periods), health score, insights
  (pace compares the same number of days into each period), monthly review (a review opens once a
  period ends), nav badges, the ledger's default range and its month stepping.
- **Statistics:** `stats_by_period` (default on) decides whether Trends groups by the same periods or by
  calendar months; the user asked for this choice. Occasional categories' quarterly view stays on
  calendar quarters.
- **Unchanged on purpose:** recurring due dates, card billing cycles and goal contributions stay
  calendar-based — they describe real-world dates, not budget months.
- **Changing the day:** a setting, not history: past budgets keep their 'YYYY-MM' rows and are read
  over the new periods. Stored review snapshots keep the numbers they were saved with.

## D-R24 · 2026-11-22 · Home as widgets; fewer navigation entries
- **Home** (was Overview) leads with "Left to spend": all monthly budget lines (monthly + general) minus
  what's been spent in them this period, and that amount per remaining day (today included). Without
  budgets it shows spending so far with a link to set budgets. Income and spending so far sit in the
  same card (the old "this month" card), so the separate P&L and budget cards are gone.
- Then: the spending ring for the period (same numbers as Trends → by category), up to 3 items that need
  attention (the rest behind "Show all"), the next 3 payments, the month-end forecast, goals, health and
  the usual month. Home is a list of widget ids (`DEFAULT_HOME`), so a later "customize Home" (library of
  widgets, drag to reorder) only needs to store another list per user.
- **Navigation:** 14 entries → 9. Pages that belong together become one entry with a tab strip on each of
  them: Upcoming · Forecast · Recurring ("Upcoming & forecast"), Trends · Monthly review ("Insights"),
  Accounts · Import, Settings · Household. URLs are unchanged (deep links, reminders, the tour keep
  working); a saved bottom bar holding a page that moved into a section maps to the section's entry.

## D-R25 · 2026-11-22 · Quick add
- The "+" sheet leads with a big amount (focused, numeric keyboard), then a grid of 7 categories with
  their emoji — this device's recently used ones first, then the household's order — and "All" for the
  full picker. "What was it?" is optional. Today and the last used account (this device) are defaults;
  date, account and notes are behind "More details". The save button says what it will add
  ("Add ₪45 expense"). Recent categories and the last account live in localStorage: per-device
  conveniences, never needed for correctness.

## D-R26 · 2026-11-22 · Suggested budgets
- `shared/domain/suggest.ts`, GET `/api/budgets/suggest?squeeze=&savings=`; applied with the normal
  PUT `/api/budgets` (recurring limits from the current period). Rules, as shown to the user:
  usual = median of the last ≤ 6 complete periods (months with no spending count as 0); fixed-group
  categories keep their usual amount (rounded up to ₪10); everyday categories and the pooled general
  expenses get the squeeze (0 / 5 / 10 %, rounded to ₪50, ≥ ₪50); occasional categories get a yearly
  limit = last 12 periods' total (rounded up to ₪100). Income = median income of the same periods.
  If fixed + everyday + occasional / 12 + savings target (0–20 % of income) exceeds income, everyday
  limits shrink by one factor, never below 70 % of usual; any remaining gap is reported as a shortfall
  instead of pretending it fits.
- **Why median, not mean:** one renovation month or a big purchase would inflate a mean-based limit
  for months; the median of six months shrugs off one or two such months.

## D-R27 · 2026-11-22 · Budget alerts and the weekly recap
- Two more reminder kinds (migration 0021 rebuilds `reminders` to widen its CHECK; one of each per user):
  - **budget:** checked hourly between 9:00 and 21:00 local by the existing 15-minute cron, only on ticks
    that have nothing else to send, for at most 3 households per tick. A budget line passing 80 % and then
    100 % of its limit gives one push each per period (`reminders.marks` remembers what was said; a line
    that jumps straight past 100 % gets only the 100 % one). Several at once → one push listing them.
    No in-app card: Home's "worth a look" already lists over / watch budgets.
  - **recap:** on a chosen weekday and hour (default Sunday 10:00). The push is one short line — spent
    in the last 7 days, the difference from the week before, and what's left this period. The full recap
    (with the week's top categories) is a card on Home until dismissed. This is the user's "short, or in
    the app" — both, with the detail in the app.
- Push text for these two is built from the household's numbers on the server; like every push, it goes
  only to the user's own devices through the encrypted Web Push channel.

## D-R28 · 2026-11-22 · Who paid (simple)
- `accounts.owner_user_id` (migration 0022, NULL = shared; validated as a household member). A spending
  line counts for its account's owner; on a shared account, a row added by hand or by Apple Pay counts
  for whoever added it (`created_by`); everything else — imported rows on shared accounts, and anyone
  no longer a member — is "Shared". Imported rows never count for the importer: importing isn't paying.
- GET `/api/dashboard/who` for the current period; Home shows a thin split bar and a row per person,
  only for households with more than one member. Deliberately no settle-up / who-owes-whom yet.
