# Astra Academy

Multi-page HTML/CSS/JavaScript website with a small Node.js 24+ backend and
persistent SQLite storage. No frontend framework, dependencies or build step.

## Run locally

```sh
npm start
npm test
```

Without npm, use `node server/server.mjs` and
`node --test tests/platform.test.mjs`.
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

## Hosting

Use a persistent Node.js 24+ environment. Hostinger Business/Cloud Node hosting
or a VPS may be suitable; verify that the chosen environment preserves the
configured SQLite path across deployments/restarts. A Hostinger VPS is the
straightforward option when filesystem persistence needs explicit control.
Static-only hosting will render HTML but cannot operate forms, accounts or payments.

Copy `.env.example` to `.env` only on the server. Supply HTTPS `BASE_URL`,
`DEMO_MODE=false`, persistent `DB_PATH`, an administrator email and a strong
administrator password, transactional email configuration and Stripe keys.
Production startup requires HTTPS and configured email. Checkout additionally
requires seller identity fields and explicit `LIVE_PAYMENTS_ENABLED=true`.
Never commit the resulting `.env`, database or real records.

Subscribe the Stripe webhook at `/api/webhook` to:

- `checkout.session.completed`, `checkout.session.expired`,
  `checkout.session.async_payment_succeeded`;
- `invoice.paid`, `invoice.payment_failed`;
- `customer.subscription.updated`, `customer.subscription.deleted`;
- `charge.refunded`.

Configure the Stripe customer portal for payment methods, invoices and
cancellation. Leave subscription product/price switching disabled, because
membership tiers are assigned through the reviewed application.

## Before public launch

Replace prototype profiles/dates, confirm the offer and seller details, and
finalize the commercial/privacy terms. Supply a Discord invitation.
Verify account emails, Stripe test checkout, subscription renewal/cancellation,
refunds and webhook delivery. Back up the SQLite database through a consistent
SQLite backup/snapshot process. Restrict production administrator access and
add monitoring and operational recovery procedures.

Newsletter signup, double confirmation and subscriber administration are
implemented; bulk newsletter composition/sending is intentionally not included.
Refund requests are reviewed by an administrator, including eligibility and
annual-month proration; they are not automatically adjudicated by the server.
No real deployment, card charge or external email is implied by this prototype.
