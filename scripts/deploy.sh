#!/usr/bin/env bash
# One-command deploy to Cloudflare Workers Free + D1 Free (PLAN §17). Idempotent.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (environment or .env.local).
# Optional: AI_API_KEY (openai-compatible provider), RESEND_API_KEY + EMAIL_FROM (invite e-mails).
# DRY_RUN=1 prints the plan without calling Cloudflare.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi
DRY_RUN="${DRY_RUN:-0}"
run() { if [[ "$DRY_RUN" == "1" ]]; then echo "[dry-run] $*"; else "$@"; fi; }
DB_NAME=maazan
WORKER=maazan
ENVNAME=production
export CI=1

# 1) credentials
if [[ "$DRY_RUN" != "1" && ( -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ) ]]; then
  echo "✗ CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set (environment or .env.local)." >&2
  echo "  Token permissions: Workers Scripts:Edit, D1:Edit, Workers AI:Read, Account Settings:Read, User Details:Read." >&2
  exit 1
fi

# 2) install + checks
echo "→ install and test"
run npm ci
run npm run typecheck
run npm run test:unit
run npm run test:api

# 3) D1 database (create if missing) and write its id into wrangler.jsonc
echo "→ D1 database"
if [[ "$DRY_RUN" == "1" ]]; then
  DB_ID="00000000-0000-0000-0000-000000000000"
else
  DB_ID="$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("[")));const d=j.find(x=>x.name==="'"$DB_NAME"'");process.stdout.write(d?d.uuid:"")})')"
  if [[ -z "$DB_ID" ]]; then
    npx wrangler d1 create "$DB_NAME" >/dev/null
    DB_ID="$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("[")));process.stdout.write(j.find(x=>x.name==="'"$DB_NAME"'").uuid)})')"
  fi
fi
node -e '
const fs=require("fs");const p="wrangler.jsonc";
const s=fs.readFileSync(p,"utf8").replace(/"database_id": "[0-9a-f-]+"/g, `"database_id": "${process.argv[1]}"`);
fs.writeFileSync(p,s);' "$DB_ID"
echo "  database_id = $DB_ID"

build() { run env CLOUDFLARE_ENV="$ENVNAME" npm run build; }
publish() {
  if [[ "$DRY_RUN" == "1" ]]; then URL="https://$WORKER.example.workers.dev"; return; fi
  local out
  out="$(npx wrangler deploy 2>&1 | tee /dev/stderr)"
  URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' <<<"$out" | head -1)"
  if [[ -z "$URL" ]]; then echo "✗ could not find the workers.dev URL in the deploy output" >&2; exit 1; fi
}
deploy_once() { build; publish; }

# 4-5) build first (the step that can fail), then migrations, then deploy right away, so the live
#    worker runs against a migrated schema only for the few seconds between the two.
echo "→ build"
build
echo "→ migrations"
run npx wrangler d1 migrations apply "$DB_NAME" --remote --env "$ENVNAME"
echo "→ deploy"
publish
HOST="${URL#https://}"

# 6) secrets (only those not set yet)
echo "→ secrets"
EXISTING=""
# A failed listing must stop the deploy: treating it as "no secrets" would regenerate BOOTSTRAP_TOKEN
# and the VAPID pair, breaking every push subscription.
if [[ "$DRY_RUN" != "1" ]]; then
  if ! EXISTING="$(npx wrangler secret list --name "$WORKER")"; then
    echo "✗ could not list the Worker's secrets; aborting before touching them" >&2
    exit 1
  fi
fi
FIRST_SETUP=0
if ! grep -q '"BOOTSTRAP_TOKEN"' <<<"$EXISTING"; then
  BOOTSTRAP_TOKEN="${BOOTSTRAP_TOKEN:-$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')}"
  if [[ "$DRY_RUN" == "1" ]]; then echo "[dry-run] wrangler secret put BOOTSTRAP_TOKEN"; else printf '%s' "$BOOTSTRAP_TOKEN" | npx wrangler secret put BOOTSTRAP_TOKEN --name "$WORKER" >/dev/null; fi
  FIRST_SETUP=1
fi
# Web Push (VAPID): generate one P-256 key pair on first deploy; never rotate it here (that would
# invalidate every device subscription).
if ! grep -q '"VAPID_PRIVATE_KEY"' <<<"$EXISTING"; then
  VAPID="$(node -e '
const { generateKeyPairSync } = require("crypto");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" }); const priv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
process.stdout.write(raw.toString("base64url") + " " + priv.d);')"
  for PAIR in "VAPID_PUBLIC_KEY ${VAPID% *}" "VAPID_PRIVATE_KEY ${VAPID#* }" "VAPID_SUBJECT ${VAPID_SUBJECT:-https://$HOST}"; do
    if [[ "$DRY_RUN" == "1" ]]; then echo "[dry-run] wrangler secret put ${PAIR%% *}"; else printf '%s' "${PAIR#* }" | npx wrangler secret put "${PAIR%% *}" --name "$WORKER" >/dev/null; fi
  done
fi
for NAME in AI_API_KEY RESEND_API_KEY EMAIL_FROM; do
  VAL="${!NAME:-}"
  if [[ -n "$VAL" ]] && ! grep -q "\"$NAME\"" <<<"$EXISTING"; then
    if [[ "$DRY_RUN" == "1" ]]; then echo "[dry-run] wrangler secret put $NAME"; else printf '%s' "$VAL" | npx wrangler secret put "$NAME" --name "$WORKER" >/dev/null; fi
  fi
done

# 7) lock WebAuthn to the deployed host (APP_HOST), then deploy once more
if grep -q '"APP_HOST": ""' wrangler.jsonc; then
  echo "→ APP_HOST = $HOST"
  node -e '
const fs=require("fs");const p="wrangler.jsonc";const s=fs.readFileSync(p,"utf8");
const i=s.indexOf("\"production\"");
fs.writeFileSync(p, s.slice(0,i)+s.slice(i).replace("\"APP_HOST\": \"\"", `"APP_HOST": "${process.argv[1]}"`));' "$HOST"
  deploy_once
fi

# 8) smoke test
echo "→ smoke test"
run node scripts/smoke.mjs "$URL"

# 9) result (the setup link is printed to this terminal only — never commit it)
echo
echo "✓ Deployed: $URL"
if [[ "$FIRST_SETUP" == "1" && "$DRY_RUN" != "1" ]]; then
  echo "  One-time super-admin setup link (open in Safari on your iPhone; keep it private):"
  echo "  $URL/setup#$BOOTSTRAP_TOKEN"
fi
echo "  Workers AI models available to you: npx wrangler ai models --json  (set AI_MODEL in wrangler.jsonc env.production)"
