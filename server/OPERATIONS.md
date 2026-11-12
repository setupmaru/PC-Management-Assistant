# Server Operations

## Production environment
- Copy `server/.env.example` to `server/.env`.
- Set `NODE_ENV=production`.
- Set `PUBLIC_BASE_URL=https://api.pc-management-assistant.setupmaru.com`.
- Set `ALLOWED_ORIGINS=https://api.pc-management-assistant.setupmaru.com`.
- Generate `BACKOFFICE_API_TOKEN` with at least 32 random characters and set the same value in the backoffice secret.
- Fill in `DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`.
- Set `OPENAI_API_KEY` on the server. `OPENAI_MODEL` is deprecated and ignored by account chat.
- Complete the Stripe Connect payout setup in the Polar dashboard.
- Create monthly Plus (KRW 4,900) and Pro (KRW 15,000) products in Polar, then set
  both product IDs. Configure either an API access token or both Checkout Link URLs.
- Register `https://api.pc-management-assistant.setupmaru.com/api/polar/webhook` as a Polar webhook endpoint,
  subscribe to the subscription events listed below, and set `POLAR_WEBHOOK_SECRET`.
- Enable 2-Step Verification on the Gmail sender account, create a Google App Password, and set
  `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and `EMAIL_FROM`. Do not use the normal Gmail password.

## API domain and DNS (V1.0.18.1)

The public API base is `https://api.pc-management-assistant.setupmaru.com/api`.
The desktop app no longer tries the two former external hostnames, including values
left in older user configuration files. Packaged apps try the new HTTPS domain first;
the LAN address `http://192.168.0.119:3400/api` and localhost remain local fallbacks.
Once a server responds, later requests reuse that address during the same app session.
After DNS and HTTPS are configured, restart the app to try the new public domain first again.
Development builds retain local-first behavior. Explicit custom server overrides remain supported.

Create this record in the Cloudflare `setupmaru.com` DNS zone:

| Type | Name | IPv4 address | Proxy | TTL |
| --- | --- | --- | --- | --- |
| A | `api.pc-management-assistant` | `211.219.70.215` | DNS only | Auto |

The public IPv4 above was verified on 2026-11-12; update the record if the server's public IP changes.
Do not put the LAN address in public DNS. No public IPv6 was verified, so do not add an AAAA record.
DNS records contain an IP, not a port or `/api` path. Verify the A record before issuing a certificate:

```bash
dig +short A api.pc-management-assistant.setupmaru.com
```

Keep this record DNS only unless a Cloudflare edge certificate explicitly covers this hostname.
It is a second-level subdomain of the zone, which the zone's standard Universal SSL certificate
does not cover. See [Cloudflare's coverage limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).

### HTTPS on the current nginx host

The current server's ports 80/443 belong to nginx. Confirm the router and firewall route
TCP 80/443 to this server (`192.168.0.119`); retain the other existing nginx sites.
Do not start another Caddy or the legacy Windows `infra/https-proxy.js` on those ports.
`infra/caddy/Caddyfile` is an alternative only for a host where Caddy already owns those ports.

After DNS resolves to this server, run the following from the repository root on the server
with administrator privileges. First install only the HTTP bootstrap site, so nginx does not
try to load certificate files that do not exist yet:

```bash
sudo install -d /var/www/letsencrypt
sudo install -m 644 infra/nginx/pc-management-assistant-api.http.conf /etc/nginx/sites-available/pc-management-assistant-api
sudo ln -s /etc/nginx/sites-available/pc-management-assistant-api /etc/nginx/sites-enabled/pc-management-assistant-api
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  -d api.pc-management-assistant.setupmaru.com \
  --deploy-hook 'systemctl reload nginx'
```

Only after certificate issuance succeeds, install the HTTPS configuration and reload nginx:

```bash
sudo install -m 644 infra/nginx/pc-management-assistant-api.conf /etc/nginx/sites-available/pc-management-assistant-api
sudo nginx -t && sudo systemctl reload nginx
```

Both nginx configs preserve the full request path. The HTTPS config allows 32 MB request bodies
so image chat requests are not rejected by nginx's smaller default limit.

Set the existing `/opt/pc-management-assistant/server/.env` public URL settings without replacing
its credentials, then restart the API service:

```dotenv
PUBLIC_BASE_URL=https://api.pc-management-assistant.setupmaru.com
ALLOWED_ORIGINS=https://api.pc-management-assistant.setupmaru.com
```

```bash
sudo systemctl restart pc-assistant-api.service
curl --fail http://127.0.0.1:3400/api/health
curl --fail https://api.pc-management-assistant.setupmaru.com/health
curl --fail https://api.pc-management-assistant.setupmaru.com/api/health
```

All health responses must report `status: ok`, `api.reachable: true`, and `db.reachable: true`.
The HTTPS certificate must cover the exact new hostname. Update the Polar dashboard webhook
to `https://api.pc-management-assistant.setupmaru.com/api/polar/webhook` as part of the domain cutover.
Publishing a desktop release does not create DNS records or certificates. Until those external
steps finish, the new public URL is unavailable and only clients on the server's LAN can use its LAN fallback.

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
https://api.pc-management-assistant.setupmaru.com/api/polar/webhook
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
