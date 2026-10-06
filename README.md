# Astra Academy

Multi-page HTML/CSS/JavaScript website with a small Node.js 24+ backend and
standard MySQL storage for hosting and SQLite for local work. Plain frontend,
no build step; one backend dependency, mysql2.

## Run locally

```sh
npm ci
npm start
npm test
```

After dependencies are installed, direct equivalents are `node server/server.mjs`
and `node --test tests/*.test.mjs`.
Open `http://127.0.0.1:4173`.

The default is a **local-only prototype**. Sample dates, prices, instructors,
member and administrator accounts are marked as demonstration data.
Demo payment buttons do not charge money. The login page has local demo entry
buttons. Demo mode refuses external connections and cannot bind to a public IP.
SQLite files, sessions, account records and local mail are excluded from Git.

## Pages

- `naryste.html`: three membership tiers and monthly/yearly pricing.
- `paraiska.html`: short application; acceptance comes before payment.
- `renginiai.html`, `renginys.html`: calendar and individual event detail/booking.
- `instruktoriai.html`, `instruktorius.html`: equal placeholder profiles.
- `naujienlaiskis.html`: consent and confirmation form.
- `registracija.html`, `prisijungti.html`: account, verification and password reset.
- `paskyra.html`: membership, bookings, attendance badges and private profile.
- `administravimas.html`: applications, members, events, instructors,
  attendance, subscribers and refund requests.
- `taisykles.html`, `privatumas.html`: provisional commercial/privacy terms.

## Editing

Edit public copy in the HTML files, styles in `styles.css` and `platform.css`.
Edit initial event seeds in `app.js`; plans and instructor seeds are in
`server/config.mjs`. Seeds populate a new database only. Once the server has
started, edit live events and profiles through the administrator page; source
seed changes do not overwrite stored administrator edits.

Prices are stored in euro cents. The backend calculates prices and benefits;
the browser cannot select an arbitrary amount.

## Membership

| Tier | Monthly | Annual |
|---|---:|---:|
| Bendruomenė | €29 | €290 |
| Praktika | €59 | €590 |
| Atramos narystė | €15 | €150 |

All membership applications are reviewed. Only an accepted applicant can open
a membership checkout. Atramos uses the same community benefits as Bendruomenė;
its eligibility indication remains private.

Active members get one community meetup per calendar month; Praktika also
includes one hike. Included visits require a published event, a free place and
membership coverage of its date. Extra events get the tier discount. Included
visits do not accumulate. Demo membership periods use 30/365 days; Stripe mode
uses the provider's actual subscription period.

## Payment integration

The server includes Stripe Checkout, subscription cancellation, the customer
portal, signature-verified webhooks and administrator-approved refund requests.
Successful browser redirects never grant membership or confirm paid tickets:
only verified payment events do. Replayed webhook events are ignored.

Real Stripe checkout and email delivery have **not** been verified against an
account. Use Stripe test mode and a verified sending domain before live activation.
The demo exercises the application's transitions without external services.

## Hosting and ownership

Use Hostinger Business Node hosting with Node.js 24 and a separate MySQL database.
The same app can run on another Node.js/MySQL host. No Hostinger SDK is used.

See [DEPLOYMENT.md](DEPLOYMENT.md) for settings, [OPERATIONS.md](OPERATIONS.md)
for ownership, backup and migration, and `.env.hostinger.example` for a public
read-only preview. Public modes require MySQL; local demo remains SQLite.

The app is deployed as a public preview. Public preview does not collect accounts, newsletter
subscriptions, bookings or payments. Production requires configured email,
final offers/terms and verified provider integration before payment activation.
