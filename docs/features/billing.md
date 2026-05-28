# Billing

**Files:**
- `server/src/services/stripe/stripeService.js` — Stripe helpers
- `server/src/routes/billing.js` — checkout, portal, webhook handler
- `client/src/pages/BillingPage.jsx` — plan cards UI

---

## Plans

| Plan | Prospects/month | Price | Stripe Price ID env var |
|---|---|---|---|
| Free | 50 | $0 | — |
| Pro | 500 | $49/month | `STRIPE_PRO_PRICE_ID` |
| Enterprise | Unlimited | $199/month | `STRIPE_ENTERPRISE_PRICE_ID` |

---

## Upgrade Flow

```
User clicks "Upgrade" → POST /api/billing/checkout { plan }
→ Stripe Checkout Session created (with org + plan in metadata)
→ User redirected to Stripe hosted page
→ On success → redirected to /billing/success
→ Stripe fires checkout.session.completed webhook
→ POST /api/billing/webhook updates org: { plan, stripeCustomerId, stripeSubscriptionId }
```

## Manage Subscription Flow

```
POST /api/billing/portal
→ Stripe Billing Portal session created
→ User redirected to Stripe portal (cancel, update payment, download invoices)
```

---

## Webhook Events Handled

| Event | Action |
|---|---|
| `checkout.session.completed` | Set org `plan`, `stripeCustomerId`, `stripeSubscriptionId` |
| `customer.subscription.deleted` | Downgrade org to `free`, set `planStatus: canceled` |
| `invoice.payment_failed` | Set org `planStatus: past_due` |

**Important:** The webhook route uses raw body (`express.raw`) — set up before `express.json()` in `app.js`.

---

## Setting Up Stripe (dev)

1. Create products + prices in Stripe Dashboard
2. Copy price IDs to `server/.env` (`STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`)
3. Install Stripe CLI: `brew install stripe/stripe-cli/stripe`
4. Listen for webhooks locally:
   ```bash
   stripe listen --forward-to localhost:5000/api/billing/webhook
   ```
5. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

---

## Current Status

- ✅ Plan schema on Organization model
- ✅ Checkout session creation
- ✅ Billing portal
- ✅ Webhook handler (3 events)
- ✅ Plan limit enforcement on prospect creation
- ⬜ Usage reset monthly (cron job needed)
- ⬜ Upgrade prompt UI when limit reached
- ⬜ Plan badge in sidebar
