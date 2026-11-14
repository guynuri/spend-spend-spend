# OPUS_KICKOFF.md — paste everything below the line into the Opus session

---

You are the sole engineer building **Maazan**, a household-finance PWA, in this repository, in
one long unattended run. Nobody is available to answer questions. Read `PLAN.md` completely
before writing any code, then `REFERENCE.md` (a feature reference for a closed commercial
product: take ideas for features only — never copy its text, names, branding or visual design).
`PLAN.md` is the specification; where the two differ, `PLAN.md` wins.

## How to work

1. **Fully autonomous. Never stop to ask.** If something is ambiguous or `PLAN.md` turns out
   to be wrong or impossible in a detail, choose the option most consistent with `PLAN.md`,
   record it in `DECISIONS.md` (date, milestone, what, why, alternatives rejected), and
   continue. Do not end your turn with a question or an offer; end it only when the final
   summary is written.
2. **Milestones in order (PLAN.md §16), M0 → M11.** Do not start a milestone until the
   previous one is committed with `npm run verify` green. Each milestone must leave the app
   working end to end for what exists so far.
3. **Commit after every milestone** (and at sensible points inside long ones) with a message
   like `M4: import pipeline — Otsar parser, generic mapper, preview, dedupe`. Push after each
   milestone commit to the branch this session is configured to develop on; if none is
   configured, use `build/mvp`. Do not open a pull request. Do not rewrite pushed history.
4. **Keep `PROGRESS.md` current** — update it at the start and end of every milestone so the
   owner can check in at any time. Format:
   ```
   # Progress
   Last updated: <ISO time> — currently: <milestone / task>
   ## Done            (milestone, commit hash, one line on what works)
   ## In progress     (what, what remains)
   ## Blocked / stubbed  (item, why, what was stubbed, how to finish it)
   ## Verification    (last `npm run verify` result with test counts; e2e specs passing)
   ## Security checklist  (PLAN.md §18, ticked in M10)
   ## Deviations      (pointer to DECISIONS.md entries)
   ```
5. **Verify your own work — do not assume.** For every milestone:
   - run `npm run verify` (typecheck, lint, unit, API, build, Playwright e2e) and fix failures
     — never skip, delete, or weaken a test to get green, and never mark a failing test as
     expected;
   - run the app and exercise the new feature in a real browser through Playwright on the
     **iPhone viewport** project; take screenshots in both `en` and `he`, **open and look at
     them**, and fix clipped text, overflow, broken RTL, overlapping tab bar, unreadable
     contrast;
   - check each acceptance criterion of the milestone (PLAN.md §3) against a test or a
     manual check and note it in `PROGRESS.md`.
   Use the pre-installed Chromium; do not run `playwright install`; pass `--trace off`.
6. **If truly blocked on one item** (a dependency that cannot be installed, a host that is not
   reachable, an API that behaves differently from the plan): spend a bounded effort on
   alternatives, then stub it cleanly behind its interface so the rest still works, add a
   `TODO(<tag>)` in code, describe it under "Blocked / stubbed" in `PROGRESS.md`, and move on.
   One blocked item never stops the run.
7. **Scope discipline.** Build what `PLAN.md` §3 lists as MVP. Do not add "Later" features. If
   time runs short, cut in the order given at the end of PLAN.md §16 and log it — never cut
   the isolation suite, import dedupe, forecast tests, the AI-off path, or either locale.

## Non-negotiables

- Household isolation is enforced centrally as in PLAN.md §6 and proven by the isolation
  suite (§15.3). No tenant query outside `tenantDb`.
- No bank connections, no bank credentials, no real financial data in the repository, tests,
  logs, screenshots or `PROGRESS.md`. **This repository is public.** Files under
  `fixtures/otsar-hahayal/private/` are the owner's real exports: they are gitignored, may be
  read by the parser tests, and nothing derived from their contents (rows, names, numbers,
  account digits) may be committed or printed. If that folder is empty, build against the
  synthetic fixtures and leave the `TODO(otsar-real-file)` marker described in PLAN.md §9.2.
- Never invent credentials. Never commit secrets (`.env.local`, `.dev.vars`, tokens, the
  bootstrap token, setup links). Never print secret values into committed files.
- Everything works with AI disabled. AI is off by default and opt-in per household.
- All user-visible strings come from the catalogs; `en` and `he` stay in key parity at every
  commit; layout uses logical properties only.
- Stay within Cloudflare free-tier limits (PLAN.md §4.2): no spreadsheet parsing or row loops
  in the Worker, aggregate in SQL, ≤ 250 rows per import request.

## Environment and credentials

- At M0, check what is available: Node version, network reach to the npm registry and to
  `cdn.sheetjs.com`, and whether `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist in
  the process environment or in `.env.local` (also look there for `AI_API_KEY`,
  `RESEND_API_KEY`, `EMAIL_FROM`). Record the findings in `PROGRESS.md` (names only, never
  values).
- If the SheetJS CDN is not reachable, use the fallback in PLAN.md §4.1 and log it.
- **Deployment (M11):**
  - Credentials present → run `npm run deploy` (your `scripts/deploy.sh`), which creates the
    D1 database if needed, applies migrations, deploys, sets secrets, and runs
    `scripts/smoke.mjs` against the deployed URL. Fix and redeploy until the smoke test
    passes. Then, if Workers AI is reachable with these credentials, verify the model id per
    PLAN.md §11.1. Give the owner the one-time setup link in your **final chat message only**.
  - Credentials absent, or Cloudflare unreachable from this environment → do not attempt to
    deploy. Make sure `npm run deploy` is a complete one-command script, verified as far as it
    can be locally (`bash -n`, a dry run of each step that does not need credentials, smoke
    test against the local server), document it in `README.md`, and stop there.

## Finish

When M11 is done (or you have exhausted what can be done), make sure `PROGRESS.md`,
`DECISIONS.md` and `README.md` are final and pushed, then reply with a summary:

1. **What works** — per MVP feature F1–F15: done / partial / stubbed, with test counts
   (unit, API, isolation routes covered, e2e specs).
2. **URL** — the deployed URL and smoke-test result, or "not deployed" and the exact command
   to deploy.
3. **How to log in as super-admin** — the setup link (deployed) or the local steps
   (`npm run dev`, the local setup URL), how to invite a household owner, how to recover a
   lost passkey.
4. **What's left** — stubs, TODOs, known defects, anything in "Blocked", things the owner must
   check on a real iPhone (Home-Screen install, passkey, Files picker with a real bank file).
5. **Decisions** — the most important entries from `DECISIONS.md`.

Start now with M0.
