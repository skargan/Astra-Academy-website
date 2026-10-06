# Astra Academy

Static website using HTML, CSS and JavaScript. No framework or build step.

## Editing

- Edit page text in `index.html`.
- Edit colors, spacing and responsive layout in `styles.css`.
- Edit the event list at the top of `app.js`.

Event fields: `state`, `title`, `description`, `place`, `price`,
and `registrationUrl`. Leave the URL empty for an event-specific email enquiry.
Add a confirmed HTTPS booking URL to show a registration button.
Keep dates and prices pending until confirmed.

## Brand assets

The eight supplied PNGs in `assets/` are preserved unchanged under descriptive
names. WebP copies are resized for the page. The Spartan crest anchors the hero,
the AA/star seal appears in the header and app icons, and the campfire appears
beside the community invitation. The dark-lettered horizontal wordmark appears
on a light footer panel. Other supplied variants are available for later use.

## Preview and deployment

Serve the repository root with any static HTTP server, or open `index.html`
directly. Deploy the root folder to a static host with no build command.

The social preview metadata targets `https://astra-academy.net`.
Its image becomes available to social crawlers when
`assets/social-preview.jpg` is hosted there.

Event enquiries open the visitor's email application. They do not reserve a
place or collect payment.
