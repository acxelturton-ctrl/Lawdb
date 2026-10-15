# Connecting Stripe to LawDB (Featured, $89/month)

LawDB never holds a Stripe API key. Stripe sends signed messages ("webhooks") to the site, and the site checks the signature with one
secret. That secret goes straight into Cloudflare, never into chat or the repository.

## 1. Add the webhook in Stripe (2 minutes)

Stripe dashboard -> Developers -> Webhooks -> **Add endpoint**

- Endpoint URL: `https://lawdb.ca/api/stripe/webhook`
- Events to send (tick exactly these four):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Save, then open the endpoint and click **Reveal** under "Signing secret" (it starts with `whsec_`).

## 2. Put the secret in Cloudflare

Workers & Pages -> lawdb -> Settings -> Variables and Secrets -> **Add**

- Type: **Secret**, name: `STRIPE_WEBHOOK_SECRET`, value: the `whsec_...` secret. Save and deploy.

Until this exists the site answers Stripe with "not configured" and nothing changes.

## 3. Let owners manage their own billing (optional but recommended)

Stripe dashboard -> Settings -> Billing -> **Customer portal** -> activate it (allow updating the card and cancelling).
Copy the portal **login link** (`https://billing.stripe.com/p/login/...`).

Cloudflare -> Variables and Secrets -> **Add** -> Type **Text** (it is not secret), name `STRIPE_PORTAL_URL`, value: that link.

Owners with a subscription then see a **Manage billing** button.

## 4. Test with no money moving

1. Stripe -> Product catalog -> Coupons -> create a coupon: 100% off, **Duration: once**, **limit to 1 redemption**, with a promotion code such as `LAWDBTEST`.
2. Stripe -> Payment links -> the $89 link -> Edit -> tick **Allow promotion codes**.
3. Make a test firm owner (a second email of yours), claim a firm, approve it in the admin Approvals tab.
4. As that owner open the dashboard -> Edit my profile -> **Upgrade to Featured**, pay with the same email and the code `LAWDBTEST`.
5. Within seconds the firm shows **Featured** in the dashboard and in the admin Overview ("Featured subscriptions").
6. In Stripe, cancel that subscription: the firm returns to Basic.
7. Untick "Allow promotion codes" again afterwards if you do not want it public.

## What happens automatically

| Stripe says | LawDB does |
|---|---|
| Payment completed, payer's email is an approved owner of the firm named in the checkout link | Firm becomes **Featured**; owner is emailed |
| Payment completed but the email does not match an owner, or no firm was named | Nothing changes; the admin gets an email and sees it on the **Payments** tab to assign or dismiss |
| Card payment fails (past due) | Firm stays Featured while Stripe retries; owner and admin are emailed |
| Subscription ends | Firm returns to Basic and the owner is emailed, unless it was already Featured by hand before it paid |

Firms made Featured by hand in the admin are never touched by a cancellation.

## Troubleshooting

- Stripe -> Developers -> Webhooks -> the endpoint shows every delivery and its response. `400` = wrong signing secret; `503` = the secret is not set in Cloudflare.
- The admin **Activity** tab shows each `stripe.checkout`, `stripe.subscription` and `firm.featured` entry.
- Events are applied once; resending one from Stripe is safe.
