# Deployment and provider notes

The repository is ready for local prototype review, not an already deployed
membership service. Keep demo mode local.

Recommended payment provider: Stripe. It supports Lithuania, hosted checkout,
recurring subscriptions and customer self-service.

Official references:

- https://stripe.com/global
- https://docs.stripe.com/payments/checkout
- https://docs.stripe.com/customer-management
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/api/invoice-payment/list
- https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/
- https://resend.com/docs/api-reference/emails/send-email

Recommended initial deployment: a Node.js 24+ process on Hostinger with a
private persistent data directory, HTTPS in front of the process and environment
variables configured through the hosting environment. Use one application
instance with this SQLite prototype. Multi-instance scaling requires a shared
database and coordinated rate limiting.

Public launch requires final seller details and terms, confirmed events,
email domain/provider configuration and a payment-provider account.
The example environment file contains names only, not credentials.

The refund policy is a proposed commercial offer, including more generous
membership withdrawal treatment. It does not remove statutory rights.
Review final implementation against the actual service before selling:
https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm
