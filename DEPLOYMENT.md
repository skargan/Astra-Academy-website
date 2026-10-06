# Hostinger deployment

## What is ready

Node.js 24+, plain HTML/CSS/JS, a standard mysql2 connection, database schema
initialization, public read-only preview, and a portable backup/restore command.
Local demo keeps SQLite. No Hostinger-only API or database is required.
The code has not yet been connected to an actual Hostinger database or deployed.
The nine automated scenarios passed against a real local MariaDB 11.4 server,
including application flows, concurrent capacity/benefits, signed webhook replay,
portable restore, public preview restrictions and SQLite-to-MySQL transfer.
The local SQLite suite also passed; its two MySQL-specific scenarios are skipped.

## Initial public preview

1. Provision a Node.js app on the existing plan, using a temporary domain and
   repository skargan/Astra-Academy-website, branch main, repository root.
   Runtime Node.js 24. Install dependencies with npm ci. There is no build step.
   Start command: npm start. If Hostinger requests an entry file instead, use
   server/server.mjs. Confirm the actual panel options; do not invent a build command.
2. Create a dedicated MySQL database and user through hosting administration.
   Configure its connection values in the app's environment settings, never GitHub.
   Use the host shown in the database settings; Hostinger documents localhost for
   same-host connections. Confirm it works from the Node app.
3. Set APP_MODE=preview, DB_DRIVER=mysql, HOST=0.0.0.0, the HTTPS temporary-domain
   BASE_URL, MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD.
   Keep LIVE_PAYMENTS_ENABLED=false and payment/email keys absent. Let the host
   supply PORT if it does; otherwise match the hosting port setting. Start the app.

The schema is created on first connection and sample events/instructors are seeded
only when those tables are empty. Startup does not overwrite stored event edits.
Account, demo-login, administration, newsletter writes, webhook and payment routes
are unavailable in preview. Public pages and event data can be inspected.
Health endpoint /api/health checks the database without revealing credentials.

## Hosting verification before domain cutover

- Confirm HTTPS, all public pages and health. Confirm preview forms cannot submit.
- Export a database backup, update a sample event through a controlled database
  operation, redeploy the same commit, and confirm the edit survives. Use preview
  records only. Then restore a backup to a different empty test database and check it.
- Check the hosting backup panel really includes this database, download a copy,
  and record a working restore procedure. Host backups do not replace an owner-held copy.
- Set CODE_REVISION to the deployed Git commit so portable backups identify their code.
- Do not change astra-academy.net DNS until the temporary-domain review is accepted.

## Production activation

Set APP_MODE=production, keep DB_DRIVER=mysql, use final HTTPS BASE_URL.
Configure RESEND_API_KEY and EMAIL_FROM for verified transactional delivery,
and ADMIN_EMAIL/ADMIN_PASSWORD through host settings. Administrator credentials
create a new account only; they do not reset an existing account's password.
Use a separate production database to avoid importing local demo users.
Use one app instance initially; IP rate limits are in memory. A reverse proxy's
IP handling must be tested before production account registration.

Payments remain disabled until Stripe test checkout, signed webhooks, renewals,
cancellation and refunds have been checked with the actual provider account.
Then configure STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, final SELLER_NAME,
SELLER_ADDRESS, SELLER_CODE and explicitly set LIVE_PAYMENTS_ENABLED=true.
Discord invitation is optional via DISCORD_INVITE_URL. This is a separate launch step.

## Official provider references

- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/
- https://sidorares.github.io/node-mysql2/docs
- https://docs.stripe.com/payments/checkout
- https://docs.stripe.com/webhooks
- https://resend.com/docs/api-reference/emails/send-email

## Verification

npm test runs local storage and application checks. To run the same business-flow
tests against a disposable local MySQL/MariaDB server, set ASTRA_TEST_MYSQL=true,
ASTRA_TEST_MYSQL_PORT and optional ASTRA_TEST_MYSQL_PASSWORD. It uses root at
127.0.0.1 to create and remove randomly named astra_test_ databases. Never point
these test settings at a production database server.
