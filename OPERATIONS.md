# Ownership, recovery and moving hosts

## Where things live

| Place | Contents | Owner action |
| --- | --- | --- |
| GitHub | Page code, styling, logos, backend, schema, starting event examples | Keep repository access; releases can be reverted |
| Hosting app | A running copy of the GitHub release and secret settings | Can be recreated on another Node.js 24 host |
| Separate MySQL database | Members, event edits, applications, bookings, purchase amounts, attendance, subscribers | Export, back up, restore on another MySQL/MariaDB host |
| Payment provider | Actual charges and subscription agreements | Keep account ownership; retain provider IDs during migration |
| Domain registrar | Ownership and routing of astra-academy.net | Can point the same address to a replacement host |

Changing hosts does not require a new brand, website or domain. GitHub alone is
not a backup of member records. Database credentials are private settings and
are not included in the code or the portable backup.

## Routine edits and release changes

Use the administrator page for stored events, instructors, applications and
attendance after production activation. Page text still lives in HTML; direct
on-page editing with publish/undo remains future work. Membership plan prices
remain in server/config.mjs. Current event editing prevents changing price/date
after bookings exist. A future-price change workflow is not implemented yet.
Orders and bookings store the agreed amount separately from the current event
price; database migration copies those exact amounts.

Website releases replace app code, not the separate MySQL database. Schema
initialization uses CREATE TABLE IF NOT EXISTS and does not erase existing rows.
Future schema changes require versioned migrations and a pre-release backup.
Owner/operator permissions are still admin/member; separate operator limits are
not implemented. Keep domain, repository, hosting and payment accounts owned by
the business owner rather than an individual contractor.

## Back up and prove recovery

Use Hostinger's database backups, plus a copy held outside Hostinger. Confirm the
actual retention in the account. Suggested operation: daily database backups,
30 days of owner-held copies, and a fresh backup before a code/database release.
The repository provides a manual portable export; scheduled off-host delivery
and encrypted storage are not configured automatically.

From the app directory, with private database connection settings loaded:

    npm run backup -- export /private-backups/astra-2026-10-06.backup.json

Choose a new filename; export refuses to overwrite an existing file. The parent
directory must exist. This file contains private records, including password
hashes. Encrypt it, restrict access, and never put it in GitHub, public assets,
email attachments or the website file manager's public folder.

To test recovery, create a new empty database and point a separate app environment
at it. Stop that app before restoring (starting it first would seed sample rows).

    npm run backup -- restore /private-backups/astra-2026-10-06.backup.json --confirm-empty

Restore refuses any database with existing application rows. It preserves users,
purchase amounts, membership/provider IDs, events, badges, subscribers and audit
records. Active sessions and password-recovery/verification links are deliberately
excluded, so users must sign in again or request new links. It never deletes or
overwrites the source database. Backups have a format/schema version. Save the
matching Git commit and restore that compatible release first.

## Move to another host

1. Set up Node.js 24 and an empty standard MySQL 8+/MariaDB 10.11+ database on the
   new host. Copy the repository, install dependencies, set the new connection
   secrets, and restore an owner-held database export. Verify with a temporary URL.
2. For final cutover, stop writes on the old app and pause checkout; export once
   more and restore into a fresh database. Preserve payment/provider IDs. Do not
   run two writable production copies. Reconcile payments that arrived during the
   pause with Stripe and verify webhook delivery before reopening checkout.
3. Point the domain to the verified new app, update BASE_URL and webhook settings,
   test sign-in and a booking, then retain the old host/backup until the new one is
   proven. Provider-owned database exports are an additional SQL recovery route.

SQLite local data can be exported with DB_DRIVER=sqlite and DB_PATH set to its
file, then restored to MySQL. Do not migrate prototype accounts into production.
If a host fails completely, restore from the latest off-host copy; records newer
than that copy must be recovered/reconciled from payment records and other sources.

## What has not been completed

Hostinger database provisioning, public deployment, automated off-host backups,
scheduled restore drills, production email/payment verification, page-text editor,
revision undo and owner/operator permissions still require configuration or work.
