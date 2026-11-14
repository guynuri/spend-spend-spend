# Progress
Last updated: 2026-11-14T22:46Z — currently: M2 auth & tenancy (starting)

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

## In progress
- M2 — auth & tenancy.

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
- M1: `npm run verify` green — unit 19, api 2, e2e 35 (iphone 34 + desktop 1).

## Security checklist
- (ticked in M10)

## Deviations
- See DECISIONS.md D-R1 … D-R5.
