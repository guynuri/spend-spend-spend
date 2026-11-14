# Maazan (מאזן)

Invite-only, multi-household money app (PWA) for Israeli households: upload the monthly bank
export, get a categorized ledger, budgets, recurring payments, an end-of-month forecast, goals,
a health score and a guided monthly review. No bank connections, ever. Runs on Cloudflare
Workers Free + D1 Free. See `PLAN.md` for the full specification.

## Requirements
- Node ≥ 22, npm.

## Local development
```bash
npm install
npm run dev            # applies local D1 migrations, then vite dev (Worker runs in workerd)
```

## Tests
```bash
npm run verify         # typecheck + lint + unit + API (workerd/D1) + build + Playwright e2e
```

(The runbook — setup link, invites, recovery, deploy — is completed in later milestones.)
