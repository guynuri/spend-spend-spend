# PREREQS.md — prepare these before starting the Opus run

Nothing here is strictly required for the build itself: without credentials Opus builds and
tests everything locally and leaves a one-command deploy. Each item you do provide removes a
stub or a manual step afterwards.

## 1. Decide (2 minutes)

- [ ] **App name.** Plan uses **Maazan** (מאזן). To change it, edit `PLAN.md` D-1 before the run.
- [ ] **Default language.** The plan ships English **and** Hebrew, follows the device language,
      and falls back to English. If you want Hebrew as the fallback, change
      `DEFAULT_LOCALE="en"` to `"he"` in `PLAN.md` §4.4 and D-2.
- [ ] **Hosting shape.** The plan uses a single Cloudflare Worker with static assets (not a
      separate Pages project) — same platform, same $0, one deploy. If you specifically need
      Pages, say so in `PLAN.md` D-3 before the run.
- [ ] **Address.** The app will live at `https://maazan.<your-subdomain>.workers.dev`. Passkeys
      are tied to the hostname: if you plan to use your own domain, set it up before inviting
      people (moving later means sending everyone a recovery link).

## 2. Cloudflare (needed for deploy; free plan)

- [ ] Cloudflare account, with the Workers `workers.dev` subdomain claimed (open
      Workers & Pages in the dashboard once).
- [ ] **Account ID** → `CLOUDFLARE_ACCOUNT_ID`.
- [ ] **API token** → `CLOUDFLARE_API_TOKEN`, custom token with account permissions:
      Workers Scripts: Edit · D1: Edit · Workers AI: Read · Account Settings: Read, and user
      permission User Details: Read. Scope it to your one account.
- [ ] Nothing to create by hand: the deploy script creates the D1 database and sets secrets.

## 3. AI (optional)

- [ ] Default is Cloudflare Workers AI: no key, uses the same account, 10,000 neurons/day
      free, does not train on your data. Nothing to prepare.
- [ ] Only if you prefer Groq: create a key, and provide `AI_PROVIDER=openai-compatible`,
      `AI_BASE_URL=https://api.groq.com/openai/v1`, `AI_API_KEY=…`; consider enabling Zero
      Data Retention in the Groq console.

## 4. Email (optional)

- [ ] Not needed — invites are links you share by WhatsApp/iMessage. Only if you own a domain
      and want invite emails: a Resend account with the domain verified → `RESEND_API_KEY`
      and `EMAIL_FROM`.

## 5. Bank fixture (strongly recommended)

- [ ] Put one or two real Otsar Ha-Hayal exports (ideally two overlapping months, .xlsx as
      downloaded) in `fixtures/otsar-hahayal/private/`.
- [ ] **The repository is public — do not commit them.** That folder is gitignored by the
      build, but it does not exist yet, so add the files only in the Opus session's working
      copy (or add the ignore rule first). If you cannot get the file into the session safely,
      skip this: Opus builds against synthetic files that follow `REFERENCE.md` §18 and marks
      the parser `TODO(otsar-real-file)`; you then test with your real file in the deployed
      app, where it is parsed on your phone and never uploaded.
- [ ] If your export contains other people's names or account numbers you would rather not
      expose even to the build session, redact them in a copy first (keep the layout).

## 6. The Opus session's environment

- [ ] Provide the variables as environment variables of the session (or a `.env.local` in the
      working copy — it is gitignored and cannot arrive through git):
      ```
      CLOUDFLARE_API_TOKEN=…
      CLOUDFLARE_ACCOUNT_ID=…
      # optional
      AI_PROVIDER=…  AI_BASE_URL=…  AI_API_KEY=…
      RESEND_API_KEY=…  EMAIL_FROM=…
      ```
- [ ] Network access from the session to: the npm registry, `cdn.sheetjs.com` (spreadsheet
      library), and for deploy `api.cloudflare.com`, `*.workers.dev`, `*.cloudflare.com`.
      If the session uses a restricted network policy, add these hosts; otherwise the build
      still completes but deploy is left to you.
- [ ] Node 22+ and a Chromium for Playwright (present in Claude Code cloud sessions).
- [ ] Merge or base the session on the branch that contains `PLAN.md`, `OPUS_KICKOFF.md`,
      `REFERENCE.md`.

## 7. After the run (your checks)

- [ ] Open the one-time setup link from Opus's final message **in Safari on your iPhone**,
      create your passkey, then Share → Add to Home Screen and sign in there.
- [ ] Upload a real bank file from Files; check the preview, then upload an overlapping month
      and confirm no duplicates.
- [ ] Create your household's card-charge item (charge day + typical amount) so the forecast
      is right from day one.
- [ ] Invite a second person to verify the invite flow before inviting other households.
