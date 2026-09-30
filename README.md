# Astra Academy website

Minimal static launch site for **Astra Academy**.

## Why this stack

The site intentionally uses only HTML, CSS and a small amount of JavaScript.

- no framework lock-in;
- no build step;
- very fast and cheap to host;
- easy to deploy to Cloudflare;
- easy for Džiugas to change through ChatGPT without learning a web framework.

## Editing the site

### Most common task: update events

Edit the `events` array at the top of `app.js`.

Each event has:

- `state` — date/status;
- `title`;
- `description`;
- `place`;
- `price`.

The page renders the cards automatically.

### Change public copy

Edit `index.html`.

### Change visual design

Edit `styles.css`.

## Current status

The site is intentionally **payment-ready, not payment-enabled**. The first public version uses an email CTA while Astra's legal entity, bank account, Google Workspace and merchant/payment account are being finalized.

Once payments are ready, replace the event CTA/payment placeholders with the selected checkout flow. Avoid storing payment details or secrets in this repository.

## Deployment

Designed to work as a static site on Cloudflare with no build command.

Suggested ownership model:

- Dainius: repository / Cloudflare owner and recovery admin;
- Džiugas: operational collaborator with permission to update public content;
- domain remains owned by Dainius / the company.

## Domain

Target domain: `astra-academy.net`.

## Content direction

Astra Academy is positioned as an active self-development community built around real-world practice: resilience, initiative, strategy, practical skills and community. The site should remain concrete and avoid generic motivational/self-help language.
