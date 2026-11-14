# Progress
Last updated: 2026-11-14T22:38Z — currently: M0 scaffold (committing)

## Done
- (none yet)

## In progress
- M0 — scaffold: Vite + Cloudflare plugin + Hono `/api/health`, wrangler config, migrations,
  Tailwind, ESLint (custom DB/i18n rules), Vitest unit + workers projects, Playwright, verify.

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
- M0: `npm run verify` green — unit 1, api 1, e2e 2 (iphone + desktop smoke).

## Security checklist
- (ticked in M10)

## Deviations
- See DECISIONS.md D-R1 … D-R5.
