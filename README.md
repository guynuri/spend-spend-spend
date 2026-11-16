# Money Money Money (כסף כסף כסף)

Invite-only, multi-household money app (installable PWA) for Israeli households. Upload the
monthly bank export (Excel/CSV — **no bank connection, ever**) and get a categorized ledger,
budgets with pace, recurring payments and an upcoming list, an end-of-month forecast with the
lowest point, goals, a 0–100 health score with published formulas, trends, and a guided monthly
review. English and Hebrew (RTL). Everything works without AI; AI is opt-in per household.

Runs on **Cloudflare Workers Free + D1 Free** (one Worker serves the SPA and the API).
Specification: `PLAN.md` · decisions taken during the build: `DECISIONS.md` · status: `PROGRESS.md`.

## Stack
TypeScript · Vite + `@cloudflare/vite-plugin` · Hono · D1 (SQL migrations, no ORM) · zod ·
React 19 + React Router 7 + TanStack Query · Tailwind 4 (logical properties only) · Radix UI ·
Recharts (lazy) · i18next · passkeys via SimpleWebAuthn · SheetJS + Papa Parse (browser only) ·
vite-plugin-pwa · Vitest (node + workerd/D1) · Playwright.

## Local development
```bash
npm install
npm run dev              # applies local D1 migrations, then vite dev (Worker runs in workerd)
```
First run: create `.dev.vars` (gitignored) with a bootstrap token, then open the setup link:
```bash
printf 'BOOTSTRAP_TOKEN=%s\nAI_PROVIDER=mock\n' "$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')" > .dev.vars
```
Open `http://localhost:5173/setup#<the token from .dev.vars>` in Chrome or Safari, enter your
name, create a passkey — you are now super-admin and owner of a new household.
For a populated household run `npm run seed:local` (fills the first empty household). The in-app tour
(Overview → *Take the tour*, or the ⓘ next to a page title) shows read-only demo data and never writes to yours.
`AI_PROVIDER=mock` gives deterministic AI output locally; omit it to run without AI.

## Tests
```bash
npm run verify           # typecheck + lint + unit + API (workerd/D1) + build (+ bundle budget) + Playwright e2e
npm run test:unit        # domain, parsers, i18n parity, source rules, contrast, AI payload canary
npm run test:api         # routes on a real local D1, incl. the household isolation suite
npm run test:e2e         # Playwright, iPhone 15 profile (Chromium) + desktop smoke
npm run gen:fixtures     # regenerate the synthetic bank files in fixtures/otsar-hahayal/synthetic
```
Real Otsar Ha-Hayal exports may be placed in `fixtures/otsar-hahayal/private/` (gitignored —
**this repository is public**); `npm run test:unit` then also parses them and prints nothing
from them.

## Deploy (one command)
Prerequisites: a Cloudflare account with the `workers.dev` subdomain claimed, and in the
environment or a gitignored `.env.local`:
```
CLOUDFLARE_API_TOKEN=…     # Workers Scripts:Edit, D1:Edit, Workers AI:Read, Account Settings:Read, User Details:Read
CLOUDFLARE_ACCOUNT_ID=…
# optional
AI_API_KEY=…               # only with AI_PROVIDER=openai-compatible (e.g. Groq)
RESEND_API_KEY=… EMAIL_FROM=…   # invite e-mails; without them invites are shared as links
```
```bash
npm run deploy
```
`scripts/deploy.sh` installs and tests, creates the D1 database if needed and writes its id into
`wrangler.jsonc`, applies migrations remotely, builds with `CLOUDFLARE_ENV=production` (adds the
Workers AI binding), deploys, sets missing secrets (generates `BOOTSTRAP_TOKEN` on first deploy),
locks passkeys to the deployed host (`APP_HOST`) and redeploys, then runs `scripts/smoke.mjs`.
On the first deploy it prints the **one-time setup link** to the terminal only.
`DRY_RUN=1 npm run deploy` shows the plan without touching Cloudflare.

- Smoke-test any deployment: `node scripts/smoke.mjs https://maazan.<subdomain>.workers.dev`
- Rollback: `npx wrangler rollback`
- AI model: after deploying, `npx wrangler ai models --json` and set `AI_MODEL` under
  `env.production.vars` (default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`).

## Runbook
**First sign-in (super-admin).** Open the setup link in **Safari on your iPhone**, enter your
name and household name, save the passkey to iCloud Keychain. Then Share → *Add to Home Screen*,
open the app from the Home Screen and *Sign in with a passkey* (Home-Screen apps keep their own
cookies). The setup link works once.

**Create a household for another family.** More → Admin → *Create household* → copy or share the
owner invite link (single use, 7 days). As super-admin you see only each household's name,
status, member count, created date and last import date — never its transactions or amounts.

**Invite members.** Household → *Invite someone* → role *Member* (can edit) or *Viewer* (read
only) → share the link. Owners can change roles, remove members and revoke pending invites. The
last owner can't be removed or demoted.

**Lost passkey.**
- A member: an owner opens Household → the member → *Lost passkey* and sends the recovery link
  (single use, 2 days). The member opens it on the new device and creates a new passkey.
- The only owner of a household: the super-admin uses Admin → *Owner recovery link*.
- The super-admin: run on your computer
  `npm run admin:recovery -- --remote --url https://maazan.<subdomain>.workers.dev`
  (needs the Cloudflare credentials) and open the printed link. Locally: `npm run admin:recovery`.

**Monthly routine.** Download the account export from the bank (Excel) → Import → choose the
file in Files → check the preview (new / already imported / merged with manual entries) →
Import. Split the credit-card charge on the Transactions page ("Same as last time" helps), check
the Budget, then run the Monthly review.

**Custom domain later.** Add a custom domain to the Worker, set `APP_HOST` to it in
`env.production.vars`, redeploy. Passkeys are bound to the old host, so send everyone a recovery
link afterwards.

**Data control.** Household → *Data control*: reset all data or delete the household (type the
household name to confirm). Households that loaded sample data earlier (the UI no longer offers it)
clear it from its banner.

## Free-tier design notes
Spreadsheets are parsed in the browser (10 ms CPU limit, and the file never leaves the phone);
aggregations run in SQL; imports upload ≤ 250 rows per request and ≤ 5,000 per file; bulk writes
are set-based `INSERT … SELECT FROM json_each(?)`; heavy pages (Recharts, SheetJS) are lazy
chunks (initial JS ≈ 183 kB gzip, enforced by `npm run build`).
