# REFERENCE.md — Feature reference: familycfo.app public demo → our Hebrew app

> Observed on 2026-11-14 and re-verified page by page on 2026-11-15 from the public demo at
> https://familycfo.app/ ("explore a live demo", sample household, no sign-in).
> **familycfo.app is a closed, commercial product.** This file is a *feature reference only*: our
> app is an original implementation with its own name, copy, branding and visual design. Do not
> copy its text, logo, name or styling. Descriptions below are paraphrased; numbers are
> illustrative only.
>
> **Our product is Hebrew-first (RTL), ₪, Israeli banking conventions.** Sections 1–14 describe
> what the reference does; each ends with an **Ours:** line where we deviate. Sections 15–18 are
> ours only (adaptations, Hebrew/RTL rules, glossary, import format).

## 0. Overall concept & UX patterns
- Frames household money in **business/CFO language**: income = "revenue", spending = "operating
  expenses", goals = "initiatives", net worth = "balance sheet", a monthly "board meeting" review.
  (Take the *idea* of a structured, business-like view; pick our own wording — see §17.)
- Layout: sidebar navigation grouped into collapsible sections, top bar with breadcrumb (group ›
  page title) + a small "page briefing" button (one-line explainer of what the page is for).
  Dark theme by default, with System/Light/Dark setting.
- **Command palette** (Ctrl+K) at the top of the sidebar: search or jump to any page.
- Sidebar header shows the current period (month + year); footer shows the signed-in user.
- **Mobile**: a bottom tab bar with four shortcuts (home, ledger, budget, advisor). The partner
  dashboard is installable to the home screen (PWA) for read-only access.
- Every metric is explainable (tooltip / "learn about" info icons; optional "financial
  explainers" toggle in settings). The landing page promises that every calculated metric shows
  its formula and every AI insight explains its reasoning.
- Sidebar items carry **status badges** with a colored dot (e.g. "3 need category" red on the
  ledger, "approaching plan" amber on budget, "50% on track" green on initiatives).
- AI outputs always carry a short "educational, not financial advice" disclaimer; rule-based
  text is labeled as algorithmic analysis.
- Floating per-page feedback button (skip for us).
- **Ours:** same shell, mirrored for RTL (sidebar on the right). Hebrew labels from §17.

### Navigation (sidebar groups → pages)
| Group | Pages |
|---|---|
| (top) | Dashboard |
| Money in/out | Ledger (transactions), Budget, Recurring commitments, Bill calendar |
| Wealth | Accounts, Balance sheet (net worth), Initiatives (goals), Partner dashboard |
| Intelligence | Reports, Review (guided monthly review), Projections, Scenario analysis |
| Planning tools | Retirement planning, Portfolio strategy, Debt payoff |
| (bottom) | AI advisor (chat), Settings, Help |
| (not in sidebar) | Household (members & roles), Audit trail — reached from Settings / Partner page |

## 1. Dashboard (executive overview)
Cards, top to bottom:
1. **Health score** 0–100 with label (e.g. "Good"), change vs last month, three headline sub-scores
   shown inline, "view analysis" opens a side drawer (see §9).
2. **Review call-to-action**: "a review is available, ~10–15 min" → start review.
3. **Month P&L**: income, expenses, net — each with actual vs *expected* for the month.
4. **Action items** (count + list, "view all"): auto-generated observations, e.g. categories over
   plan, uncategorized transactions, a category X% above its 3-month average, spending pace vs
   last month. Each row links to the relevant page. Positive observations are included too.
5. **Budget summary**: % spent vs % of month elapsed, over/under amount; split into
   *discretionary* (amount left of its sub-total, with "on pace" status) vs *fixed costs*
   (committed/locked); list of categories needing attention ("watch") vs count on pace.
6. **Initiatives summary**: each goal with status (Behind / On track), monthly contribution, % done.
7. **Financial position**: assets, liabilities, net worth, change vs last month.

## 2. Ledger (transactions)
- Collapsible header summary: number of accounts, total assets/liabilities, which are synced;
  link to the account registry.
- Search box; filters: accounts, categories, date range (defaults to the current week), tags;
  active filters shown as removable chips; filter state lives in the URL query string.
- **Table view** columns: select checkbox, amount (income green, signed), description, date,
  account, category, recurring marker (e.g. "Monthly"), transfer marker, notes, split, tags.
  **Inline editing** of amount, description, date, account, category, notes, tags; sortable columns.
- **Chart view**: period granularity (day/week/month), group by (none/category/account); KPIs:
  total income, total spending, net, average daily spend; clicking a data point filters the table.
- Banner: "N uncategorized transactions need attention" + "show only" filter + a
  **Categorize (N)** bulk AI action (shows an error toast and falls back to manual when AI fails).
- **Split transaction** per expense row. Row checkboxes for bulk actions.
- Export ledger. "Manage categories" link.
- Statement upload is reached from here (accounts page links to "statement upload in Ledger").
- **Ours:** import (§18) is the primary data source, so the upload entry point is prominent.
  Default date range = current month, not week. Bulk categorize must work without AI
  (rules: payee contains → category; learn a rule when the user categorizes by hand).

## 3. Budget (operating budget)
- Month selector (prev/next, "current" tag); total budget, number of categories, % spent;
  "modify budget" (guided 3-step workflow with category suggestions, per the landing page).
- Allocation check: "X of Y allocated — balanced" (zero-based style check) with a full-width bar.
- **Budget workspace table**, per category: planned limit (editable inline), average spend,
  spent, remaining/over, utilization % with colored bar (green / amber near limit / red over),
  link to that category's ledger. Save per row / save all / discard; add/edit categories.
- Counts: categories over / on plan / under plan.
- **Month pace**: % spent vs % of month elapsed (day N of M), spent, remaining, total,
  ahead/behind pace sentence.
- Historical performance chart (expenses vs income per month, 6 months) and expense
  distribution (donut, top 6 categories + "other", amount and %).

## 4. Recurring commitments (subscriptions registry)
- Totals: monthly cost, annual cost, active count, a subscriptions "health score" (0–100 + label).
- Breakdown by subscription category (amount + number of services), category filter chips.
- Table: name, category, monthly, annual, source (confirmed/detected), status, actions; sort by
  cost/name/next renewal.
- **"AI scan for recurring"** (detect recurring charges from history) + manual add.
- Cross-links to bill calendar and projections.
- **Ours:** covers standing orders (הוראות קבע), subscriptions, and fixed bills in one registry.
  Detection is deterministic first (same payee, similar amount, monthly cadence over 2–3
  months); AI only refines names/categories. Skip the subscriptions health score in MVP.

## 5. Bill calendar (upcoming payments)
- Month calendar (prev/next, "today") of forward-looking recurring cash events, color-coded by
  type: income, operating expense, recurring commitment, transfer, other. Filters by type
  (subscriptions / bills / transfers / income / other) and by category.
- KPIs: expenses next 30 days, projected income next 30 days, number of recurring items, peak
  outflow day.
- **Upcoming list (next 45 days)**: grouped by date; payee, amount, frequency.
- **Ours:** week starts Sunday (same as reference). Add the credit-card charge day(s) and
  salary day as first-class calendar events — they dominate Israeli cash flow.

## 6. Accounts & balance sheet
- "Operations workspace" with two steps: (1) source setup — connect / upload statements /
  manual accounts; (2) **reconciliation queue** — needs reconciliation, stale balances (30+
  days), last reconciled. Registry health counts (total, transactional, reconciled).
- Account registry, grouped into asset vs liability transaction accounts: checking, savings,
  investment, credit card; each shows institution, source (synced/manual), reported balance vs
  ledger balance and **variance**, opening balance + date, last reconciled, "record statement
  balance", "view transactions".
- Data sources: bank aggregation (Plaid in the reference, with connection-health states —
  **not applicable to us**), statement upload, or manual accounts.
- Property & assets (real estate, vehicle): current value, equity / % owned, purchase price and
  date, valuation source and age, "record valuation". Long-term liabilities (mortgage, loans):
  balance owed, interest rate, linked collateral asset → equity; "update balance".
- Balance sheet page: total assets/liabilities/net worth with change vs previous month,
  net-worth-over-time chart (12 months; net worth, assets, liabilities series), asset allocation
  by account type, account summary by type, "what you own / what you owe" lists.
- **Ours:** the bank file carries a running balance per row (§18), so reported balance and
  reconciliation come for free on import — variance = file balance − ledger balance.
  Israeli asset types to support later: פיקדון, קרן השתלמות, קופת גמל, פנסיה (manual valuations).

## 7. Initiatives (goals) — important
- Two tabs: **list** and **roadmap**. Header actions: prioritize, AI recommendations, new.
- Each initiative: name, description, target amount, saved so far, % progress, remaining,
  **target date → days left → required monthly contribution**, status (Behind / On track).
  Cards grouped "needs attention" (expanded detail) vs "on track" (compact).
- **Capital allocation**: monthly surplus vs total committed to initiatives (% of surplus
  allocated, buffer left). Priority ordering; dependencies ("funded after: pay off credit card").
- Recommended monthly amount per initiative ("planning guidance only, no money moves").
- **Milestones** per initiative (e.g. 25% / 50% / custom label, done date), add contribution.
- **Roadmap**: Gantt-style timeline (6/12/24-month zoom), bar per initiative colored by status
  (on track / behind / unfunded-queued), today line, milestone and target-date markers;
  "funding sequences" list: finishing A frees ₪X/month for B from month M.
- Optional AI "roadmap analysis" (sequencing, capacity, risk).
- Summary: active, completed, total saved, overall progress, count behind schedule.
- A debt payoff can be modelled as an initiative (target = original balance).

## 8. Review (guided AI review) — key differentiator
- Choose a cadence: **weekly check-in** (~5–7 min), **monthly review** (~10–15 min),
  **quarterly strategic review** (~20–25 min). Past reviews are kept. Link to check recent
  transactions before starting.
- Monthly review is a **chaptered walkthrough**: progress bar, chapter list with checkmarks
  (clickable), previous/continue, "skip to verdict". Each chapter ends with a short analyst
  commentary paragraph. Chapters:
  1. **Opening brief** — celebration chips (e.g. score up N points), health score + label,
     month summary (income / expenses / net), 3–4 headline bullets.
  2. **Income** — total and change vs previous period, sources chart, breakdown by income
     category with % of total.
  3. **Expenses** — total, change vs previous, over/under budget, bar chart by category,
     category table (amount, % of total), **notable transactions** (unusually large ones, each
     with a one-line note).
  4. **Budget** — compliance rate (categories on track / total), on-track vs over counts,
     per-category bar: spent / planned, %, remaining or over-by.
  5. **Initiatives** — overall progress, total funded of total target, on track vs needs
     attention, per-initiative progress and monthly amount needed; milestone celebration chip.
  6. **Cash flow** — monthly income, expenses, net with savings rate; upcoming obligations
     (next few dated items, signed); recommendation card.
  7. **Verdict** — headline assessment + health score; **wins** list; **areas for focus** list;
     **recommended action plan** (numbered); review alerts; short analyst commentary.
     "Complete review" saves it. Option to generate a **partner briefing** from it.
- **Ours:** every chapter is fully rule-generated; AI (when enabled) only rewrites the
  commentary paragraph and the verdict headline. MVP = monthly only; weekly/quarterly later.

## 9. Health score
- Overall 0–100 with label, monthly trend line.
- Five weighted sub-scores (observed names and weights; rename for ours):
  | Sub-score | Weight | Observed input → interpretation |
  |---|---|---|
  | Capital preservation | 25% | savings rate, % of income (above 20% rated excellent) |
  | Debt service | 20% | debt payments as % of income (below 36% rated healthy) |
  | Operating reserve | 25% | months of expenses covered by liquid funds (3–6 months is the target; 1.4 scored 35) |
  | Budget compliance | 15% | share of categories on/under plan (above 80% rated good) |
  | Initiative progress | 15% | goals on track against their timeline |
- Each sub-score has its own label (Good / Needs attention).
- Visuals: horizontal bar per sub-score, radar chart, score trend.
- **Recommendations** in the drawer: ranked list, each with an estimated overall-score gain
  ("+3.0 pts") and its concrete effect — a strong pattern, keep it.
- Key ratios shown elsewhere: savings rate (vs 20% target), debt-to-income, operating runway.
- The exact mapping from input to 0–100 is not shown → **we must define our own** (in PLAN.md):
  piecewise-linear per sub-score, published in the explainer tooltip.

## 10. Projections & scenarios
- **Projections**: horizon selector (30/60/90 days, 6 months, 1 year) from an editable current
  balance; shows income/expenses/net/subscriptions; tabs for charts, recurring items, upcoming
  30 days, **daily projected balance**, net-worth trajectory; insight bullets (e.g. runway
  warning, when a goal will be reached, expense trend). Needs ~2–3 months of history to detect
  recurring items (empty state says so, with an import button).
- **Scenario analysis**: baseline from current month actuals; sliders (income change −50…+100%,
  expense change −50…+50%, surplus allocation 0…50%, extra monthly payment) → projected monthly
  surplus vs current; 12-month chart comparing current trajectory vs budget plan vs "with
  changes" (updates instantly, no AI needed); preset scenarios grouped by theme (savings, major
  purchases, income changes, expense changes, debt); "get AI analysis" and free-text "ask your own".
- **Ours MVP:** only an **end-of-month forecast** (balance on the last day and on the day after
  the next credit-card charge) from recurring items + pace. Full projections/scenarios later.

## 11. Planning tools
- **Debt payoff**: avalanche vs snowball, extra monthly payment, list of debts (APR, minimum;
  pull from accounts or add manually, include/exclude each), total debt, debt-free date, total
  interest, interest and months saved vs minimum-only, payoff timeline chart and order.
- **Retirement planning**: inputs (ages, salary, current portfolio prefilled from investment
  accounts, monthly contribution, employer match, state pension start age/benefit, advanced
  assumptions: return, inflation, length); outputs: readiness score, projected balance (nominal
  and in today's money), years to retirement, portfolio duration, growth and withdrawal charts,
  recommendations.
- **Portfolio strategy**: holdings table (ticker, quantity, price, value, cost basis,
  gain/loss), allocation by asset class, per-account share; AI allocation advice from a risk
  profile form.
- **Ours:** all three are out of MVP. Retirement/portfolio need Israeli instruments (pension,
  קרן השתלמות, קופת גמל) and are the lowest priority.

## 12. Reports
Generated statements by period (month/quarter/year, pick year + month), on demand, PDF export:
executive summary, income statement, cash-flow statement, money-flow Sankey, balance sheet,
budget variance, historical performance, key metrics, exportable weekly/monthly statements.
- Executive summary contents: net position, analyst notes, income / expenses / net with change
  vs prior period, savings rate, initiatives progress, budget variance (favorable vs
  unfavorable counts + bars), positive developments, **action items with high/medium/low
  priority**, expense distribution chart (click a category → its transactions).

## 13. AI advisor (chat)
Chat with saved conversation history (title, age, message count) about the household's data
(e.g. budget variance analysis, emergency-fund strategy). Locked in the demo.

## 14. Household & roles, settings
- Create a household, invite members with roles: **owner/"CFO"** (full), **partner** (can edit),
  **observer** (view only); category-level visibility (full / summary / hidden) per role
  (from landing page); activity log / audit trail of who changed what.
- **Partner dashboard**: a one-page briefing for the other adult — latest review summary, wins,
  focus areas, analyst quote, health score, key ratios (savings rate, debt-to-income, runway),
  liquidity (current account, reserve, short-term liabilities, net position), current period
  P&L with days remaining, initiatives progress, initiatives roadmap (monthly amount, months
  remaining, target, dependency), expense distribution, action items, generation timestamp.
- Settings: theme, explainers toggle, re-run onboarding wizard, notifications (budget overspend
  alerts, bill reminders 3 days before, weekly summary digest), audit trail, reset data, delete
  account (danger zone).
- Sign-in on the reference: Google, email + password, magic link.

## 15. Adaptation notes for OUR app (not from the reference)
- No bank aggregation. Data comes from **monthly Excel upload** (Bank Otsar Ha-Hayal first,
  format in §18) + manual entry. Credit-card spend arrives as a single monthly lump charge in
  the bank file.
- **Credit-card lump** consequence: category detail for card spend is unavailable from the bank
  file alone. MVP: the lump is one transaction the user may **split** by category (the split
  feature from §2 becomes essential, with "remember last month's split" as a shortcut). Later:
  import the card issuer's own monthly export and link it to the lump so it is not double counted.
- Currency ₪; Israeli date format; **Hebrew is the primary and default language** (see §16).
- Multi-household, invite-only; household isolation is a hard requirement.
- Free AI tier, opt-in per household; everything must work without AI (rule-based insights,
  deterministic forecasts and scores; AI only adds narrative/commentary/categorization).
  AI output must be requested and rendered in Hebrew.
- Reference inconsistencies **not to reproduce** (define each number once, compute it one way):
  the demo mixes two different "current" months; dashboard and budget page disagree on % of
  budget spent; a sub-score explanation reuses the wrong unit; portfolio shares exceed 100%;
  calendar income and expense KPIs show the same figure.
- Suggested MVP priority (Fable decides): dashboard, ledger + import, categories/rules, budget +
  pace, recurring + upcoming payments, end-of-month forecast, initiatives, health score, monthly
  review (AI narrative optional), household roles. Later: scenarios, debt payoff, reports,
  advisor chat, retirement/portfolio, notifications.

## 16. Hebrew & RTL rules (ours)
- `<html lang="he" dir="rtl">`. Layout uses CSS logical properties only (`margin-inline-start`,
  `inset-inline-end`, `text-align: start`) — never left/right — so an LTR locale stays possible.
- All UI strings come from one message catalog keyed by id (he is the source locale; en
  optional later). No Hebrew literals in components.
- Numbers, amounts, dates and percentages are LTR islands inside RTL text: wrap them in
  `<bdi>` / `unicode-bidi: isolate` so the minus sign and ₪ do not jump sides.
- Formatting via `Intl` with `he-IL`: currency in ₪ with two decimals, dates `dd/MM/yyyy`,
  month names in Hebrew (`נובמבר 2026`), week starts Sunday.
- Charts: time axis stays left→right (oldest on the left) as is conventional in Israeli
  finance UIs; legends, labels and tooltips are Hebrew and right-aligned. Progress bars fill
  from the right. Directional icons (chevrons, arrows, "next") are mirrored; trend arrows are not.
- Hebrew pluralization and gender: use ICU plural forms (one / two / many / other); phrase copy
  in gender-neutral forms (infinitive or plural: "לסווג 3 תנועות", not "סווג").
- Free-text bank descriptions may mix Hebrew, English and digits — always render with
  `dir="auto"`.
- Font with good Hebrew coverage and tabular numerals (e.g. Heebo, Assistant, Rubik).
- Search and category rules must be insensitive to trailing spaces, niqqud, and
  quote variants (״ vs ").

## 17. Hebrew glossary (ours — our own wording, not a translation of the reference)
Plain household language rather than corporate jargon; the "business view" comes from the
structure, not from the vocabulary.

| Concept | Reference wording | Our Hebrew label |
|---|---|---|
| Dashboard | Executive dashboard | מבט־על |
| Ledger | Transaction ledger | תנועות |
| Budget | Operating budget | תקציב |
| Recurring commitments | Recurring commitments registry | תשלומים קבועים |
| Bill calendar | Bill calendar | לוח תשלומים |
| Accounts | Account registry | חשבונות |
| Balance sheet / net worth | Balance sheet | שווי נקי |
| Initiatives / goals | Strategic initiatives | יעדים |
| Partner dashboard | Partner dashboard | תקציר משפחתי |
| Reports | Financial statements | דוחות |
| Review | CFO review | סיכום חודשי |
| Projections | Financial projections | תחזית |
| Scenario analysis | Scenario analysis | מה אם |
| Debt payoff | Liability management | סילוק חובות |
| AI advisor | CFO advisor | יועץ |
| Settings / Household | Settings / My household | הגדרות / משק הבית |
| Income / expenses / net | Revenue / OpEx / surplus | הכנסות / הוצאות / נשאר |
| Health score | Resilience index | מדד חוסן |
| Savings rate | Capital preservation rate | שיעור חיסכון |
| Debt load | Debt service ratio | נטל חוב |
| Emergency runway | Operational reserve | כרית ביטחון (חודשי מחיה) |
| Budget compliance | Budget compliance | עמידה בתקציב |
| Goal progress | Initiative progress | התקדמות ביעדים |
| On track / behind | On track / behind | בקצב / בפיגור |
| Fixed / discretionary | Fixed costs / discretionary | קבועות / משתנות |
| Uncategorized | Uncategorized | ללא קטגוריה |
| Monthly pace | Month pace | קצב חודשי |
| Roles | CFO / partner / observer | מנהל/ת / שותף/ה / צופה |
| Wins / focus areas / action plan | (verdict) | הצלחות / לשים לב / צעדים הבאים |
| Disclaimer | Not financial advice | מידע כללי בלבד, אינו ייעוץ פיננסי |

## 18. Import format — Bank Otsar Ha-Hayal account export (ours)
Observed from the sample file `report__2026-10-01__2026-10-31.xlsx` (one sheet, RTL):
- Rows 1–4: metadata — title; account number + export timestamp; account type; date range
  ("מתאריך … עד תאריך …"). Row 5 empty. **Row 6 = header**, data from row 7. Column A is empty.
- Columns B–I, in order: `יתרה` (running balance), `תאריך ערך` (value date), `זכות` (credit),
  `חובה` (debit), `תיאור` (description, padded with trailing spaces → trim), `אסמכתא`
  (reference no.), `סוג פעולה` (operation type), `תאריך` (transaction date).
- Dates are Excel serial numbers (not strings); amounts are plain numbers; one of
  credit/debit is filled per row.
- The balance cell is `0` on some rows (apparently only the last row of a day carries the real
  balance) → treat 0-with-other-rows-that-day as "missing", not as a zero balance. Verify
  against more files before relying on it.
- Parser rules: locate the header row by matching the Hebrew column names (do not hard-code
  row 6); derive the statement period from row 4; signed amount = credit − debit;
  dedupe key = (account, date, amount, reference, description); re-uploading an overlapping
  period must not create duplicates; never store the account number beyond a masked suffix.
- `סוג פעולה` is a useful first-pass signal for rules (standing order, card charge, transfer,
  salary) before any payee matching.
