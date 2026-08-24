# Server Operations

## Production environment
- Copy `server/.env.example` to `server/.env`.
- Set `NODE_ENV=production`.
- Set `PUBLIC_BASE_URL=http://api.setupmaru.com:3400`.
- Set `ALLOWED_ORIGINS=http://api.setupmaru.com:3400`.
- Fill in `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOSS_CLIENT_KEY`, and `TOSS_SECRET_KEY`.
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
3. Run `npm run build` inside `server`.
4. Restart the production process.
5. Verify `/health` and `/api/health`.

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
