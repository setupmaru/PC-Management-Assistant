# Server Operations

## Production environment
- Copy `server/.env.example` to `server/.env`.
- Set `NODE_ENV=production`.
- Set `PUBLIC_BASE_URL=https://pma-api.setupmaru.com`.
- Set `ALLOWED_ORIGINS=https://pma-api.setupmaru.com`.
- Generate `BACKOFFICE_API_TOKEN` with at least 32 random characters and set the same value in the backoffice secret.
- Fill in `DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`.
- Set `OPENAI_API_KEY` on the server. `OPENAI_MODEL` is deprecated and ignored by account chat.
- Complete the Stripe Connect payout setup in the Polar dashboard.
- Create monthly Plus (KRW 4,900) and Pro (KRW 15,000) products in Polar, then set
  both product IDs. Configure either an API access token or both Checkout Link URLs.
- Register `https://pma-api.setupmaru.com/api/polar/webhook` as a Polar webhook endpoint,
  subscribe to the subscription events listed below, and set `POLAR_WEBHOOK_SECRET`.
- Enable 2-Step Verification on the Gmail sender account, create a Google App Password, and set
  `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and `EMAIL_FROM`. Do not use the normal Gmail password.

## First run
```powershell
cd server
npm run build
node dist/index.js
```

Health checks:
```powershell
curl.exe http://127.0.0.1:3400/health
curl.exe http://127.0.0.1:3400/api/health
```

## Regular restart
```powershell
cd server
powershell -ExecutionPolicy Bypass -File .\scripts\Start-ProductionServer.ps1
```

## Windows auto-start options
Recommended:
- Use NSSM or another Windows service wrapper to run `node dist/index.js` in the `server` directory.
- Run the wrapper with the same environment variables that are stored in `server/.env`.

Minimal option:
- Register a Task Scheduler job that runs `powershell -ExecutionPolicy Bypass -File C:\path\to\server\scripts\Start-ProductionServer.ps1 -SkipBuild` at startup.

## Deployment checklist
1. Update application files on the server.
2. Review `server/.env`.
3. Run `psql "$DATABASE_URL" -f schema.sql` inside `server`.
4. Run `npm ci && npm run build` inside `server`.
5. Restart the production process.
6. Verify `/health` and `/api/health`.

The OpenAI key must exist only in `server/.env` or the server process environment. Do not
put it in the desktop app `.env`, Vite defines, packaged resources, or user settings.

## Account chat models (V1.0.17)

Apply `schema.sql` before restarting the API, then publish desktop tag `v1.0.17`.
The migration adds `users.chat_model` with default `gpt-5.4-mini` and an exact-model CHECK.
It is additive and repeatable. Rollback can leave this column in place.

Authenticated `GET /api/auth/settings` returns `{ chatModel, models: [{ id, label }] }`.
`PATCH /api/auth/settings` accepts `{ chatModel }`; identity comes only from the verified
user ID and the current database email, never from request body or token email.
All accounts may select `gpt-4o-mini`, `gpt-5.4-mini`, or `gpt-5.5`.
Only the literal database email `setupmaru@setupmaru.com` may select `gpt-6-astra`.
The former `setupmaru@setupmaru` exception is removed. No account is auto-routed to Astra.
Unauthorized stored choices fall back to balanced; missing accounts fail closed before quota use.
Model selection is reread for every chat. Free/Plus/Pro restrictions are unchanged.
`OPENAI_MODEL` is deprecated and cannot override this policy.

Local checks (no production credentials): `npm test`, `npm run build`, and
`PG_TEST_BINDIR=/path/to/postgresql/bin npm run test:schema` in `server`.
The schema test creates/stops/removes its own isolated cluster on a temporary Unix socket.
Before release, separately verify actual upstream availability for all four models using
an authorized test account; test doubles only verify request parameters and policy.

## Polar payments

Production variables:

```text
POLAR_ENVIRONMENT=production
# Required for authenticated Checkout Sessions, in-app cancellation, and customer portal links
POLAR_ACCESS_TOKEN=polar_oat_...
# Required before checkout is enabled
POLAR_WEBHOOK_SECRET=polar_whs_...
POLAR_PLUS_PRODUCT_ID=<monthly-plus-product-id>
POLAR_PRO_PRODUCT_ID=<monthly-pro-product-id>
# Checkout Link fallback when POLAR_ACCESS_TOKEN is not available
POLAR_PLUS_CHECKOUT_URL=https://buy.polar.sh/polar_cl_...
POLAR_PRO_CHECKOUT_URL=https://buy.polar.sh/polar_cl_...
```

Webhook URL:

```text
https://pma-api.setupmaru.com/api/polar/webhook
```

Subscribe to `subscription.created`, `subscription.updated`, `subscription.active`,
`subscription.canceled`, `subscription.uncanceled`, `subscription.revoked`, and
`subscription.past_due`. The API refuses to open a checkout until both the checkout
credentials and webhook secret are configured, so a successful charge cannot silently
skip plan provisioning.

In Polar **Settings → Billing → Customer portal**, enable subscription plan changes so
Plus customers can switch to Pro from the in-app Polar portal.

## Email verification checks

New email accounts receive a six-digit code. The code expires after 10 minutes by default and
can be resent after 60 seconds. Existing users are marked verified when the schema migration is
first applied.

Required production variables:

```text
GMAIL_USER=your-account@gmail.com
GMAIL_APP_PASSWORD=your-google-app-password
EMAIL_FROM=your-account@gmail.com
EMAIL_VERIFICATION_SECRET=an-independent-random-secret
```

Apply the additive schema migration before restarting the API server:

```bash
psql "$DATABASE_URL" -f schema.sql
```
