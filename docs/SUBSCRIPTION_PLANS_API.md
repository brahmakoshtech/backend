# Subscription plans & credit packs — API integration guide

Base URL: `https://<your-host>/api` (local: `http://localhost:4000/api`).

Authentication: `Authorization: Bearer <JWT>` unless noted.

**Tenancy:** Every plan belongs to one **client** (white-label tenant). End users only see plans where `ownerClient` matches their `User.clientId` (MongoDB `Client` document `_id`).

**Money fields:** `mrpMinorUnits` and `offerPriceMinorUnits` are integers in the **smallest currency unit** (USD/AED/INR: `100` = 1.00 in major units). Display: `amountMajor = minor / 100`.

**Credits:** `creditsPerGrant` is the base credits per purchase or per billing period. If `billingInterval` is `year` and `yearlyExtraCredits` > 0, the effective grant is `creditsPerGrant + yearlyExtraCredits` (exposed as `creditsGranted` in list responses).

---

## 1. Client dashboard — manage plans

Prefix: `/client/subscription-plans`  
Roles: `client`, `admin`, `super_admin`.

### 1.1 List plans

`GET /client/subscription-plans`

| Caller | Query / body |
|--------|----------------|
| **Client** (JWT role `client`) | No params — lists plans for the logged-in client. |
| **Admin / super_admin** | `?ownerClientId=<MongoId>` **or** `?clientCode=CLI-XXXXXX` (human-readable client id from `Client.clientId`). |

**Response:** `{ success, data: { plans: [...] } }`  
Each plan includes internal Stripe ids for debugging; mobile storefront responses hide those (see §2).

### 1.2 Create plan

`POST /client/subscription-plans`  
Content-Type: `application/json`

| Caller | Required |
|--------|----------|
| **Client** | JSON body (below). Tenant is always the logged-in client. |
| **Admin** | Same body **plus** `ownerClientId` (Mongo ObjectId) **or** `clientCode`. |

**Body (all billing types):**

| Field | Type | Notes |
|-------|------|--------|
| `name` | string | Required. |
| `description` | string | Optional. |
| `mrpMinorUnits` | number | ≥ 0. |
| `offerPriceMinorUnits` | number | Charged amount (minor units). For recurring, this is the **per-interval** price. Must be ≥ 1 for paid recurring (Stripe). |
| `currency` | `"USD"` \| `"AED"` \| `"INR"` | Required. |
| `creditsPerGrant` | number | Credits per successful payment / per invoice period. |
| `billingType` | `"one_time"` \| `"recurring"` | Required. |
| `billingInterval` | `"month"` \| `"year"` | Required if `billingType` is `recurring`. |
| `yearlyExtraCredits` | number | Optional; added to `creditsPerGrant` when interval is `year`. |
| `features` | string[] | Optional. |
| `imageUrl` | string | Optional. |
| `payModel` | `"freemium"` \| `"premium"` | Default `premium`. |
| `isEnabled` | boolean | Default `true`. |
| `sortOrder` | number | Default `0` (lower first in catalog). |

**Recurring plans:** If Stripe secret keys are configured (`STRIPE_SECRET_KEY` / `STRIPE_SECRET_KEY_TEST` / prod variants), the server creates a Stripe **Product** and **recurring Price** and stores `stripeProductId` / `stripePriceId` on the plan. If Stripe is missing or invalid, create fails with `400`.

**One-time plans:** No Stripe product is stored; checkout uses a **PaymentIntent** with amount from `offerPriceMinorUnits`.

### 1.3 Get one plan

`GET /client/subscription-plans/:id`

Access: client may only read own tenant’s plan; admin may read any (by id).

### 1.4 Update plan

`PATCH /client/subscription-plans/:id`

Partial body (same fields as create). For **recurring** plans, Stripe price is **re-synced only** when price-relevant fields change (`name`, `offerPriceMinorUnits`, `currency`, `billingInterval`, `billingType`) or when `stripePriceId` was missing.

Switching `billingType` from `recurring` to `one_time` clears Stripe ids on the plan.

### 1.5 Delete plan

`DELETE /client/subscription-plans/:id`

Hard delete. Ensure no live marketing links rely on this id.

---

## 2. End user — catalog & purchases

Prefix: `/user`  
Role: `user` (standard app user JWT).

### 2.1 List visible plans

`GET /user/subscription-plans`

Returns only `isEnabled: true` plans for the user’s `clientId`.  
If the user has no `clientId`, `plans` is an empty array.

**Response highlights:** `data.plans[]` (no Stripe secrets), `data.userCredits`, `data.client` (optional summary).

### 2.2 List active subscriptions

`GET /user/subscriptions`

Returns Stripe-linked rows from `UserSubscription` (status, period end, populated plan summary).

### 2.3 One-time pack — create PaymentIntent

`POST /user/payment/by-plan/intent`  
Body: `{ "planId": "<MongoId>" }`

- Plan must be `billingType: "one_time"`, enabled, same tenant as user.
- If `offerPriceMinorUnits >= 1`, returns Stripe `clientSecret`, `publishableKey`, `paymentIntentId`, `credits`, `currency`, `amountMinorUnits`.

**Client integration:** Use Stripe.js / mobile SDK with the `clientSecret` (same pattern as legacy `/user/payment/create-intent`).

### 2.4 One-time pack — confirm & grant credits

`POST /user/payment/by-plan/confirm`  
Body: `{ "paymentIntentId": "pi_..." }`

Call after payment succeeds (or on return URL flow). Idempotent: repeats return success without double-crediting.

**Do not use** for PaymentIntents created by the legacy custom-amount flow (`/user/payment/create-intent` without plan metadata) — those still use `POST /user/payment/confirm`.

### 2.5 Recurring subscription — Stripe Checkout

`POST /user/payment/by-plan/subscription-checkout`  
Body:

```json
{
  "planId": "<MongoId>",
  "successUrl": "https://yourapp.com/billing/success",
  "cancelUrl": "https://yourapp.com/billing/cancel"
}
```

- URLs must be absolute `http`/`https`, **or** omit both and set env defaults: `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`.
- If `successUrl` does not contain `{CHECKOUT_SESSION_ID}`, the server appends `session_id={CHECKOUT_SESSION_ID}` so you can read the session on the success page.

**Response:** `{ checkoutUrl, sessionId, publishableKey }` — open `checkoutUrl` in a browser / WebView.

Credits are granted on **each paid invoice** via webhook (`invoice.paid`), not by this endpoint.

### 2.6 Free (zero-price) one-time pack

`POST /user/plans/claim-free`  
Body: `{ "planId": "<MongoId>" }`

Eligible plans: `one_time`, `offerPriceMinorUnits === 0`, enabled, same tenant. **One claim per user per plan** (enforced). Returns granted credits and new balance.

---

## 3. Stripe webhook (server-to-server)

**Endpoint:** `POST /user/payment/webhook`  
**No JWT.** Stripe signs the payload.

Configure in Stripe Dashboard → Developers → Webhooks. Use the **raw body** (this route is registered **before** `express.json()` in `app.js`).

**Secrets (env):**

- Test: `STRIPE_WEBHOOK_SECRET_TEST` or `STRIPE_WEBHOOK_SECRET`
- Prod: `STRIPE_WEBHOOK_SECRET_PROD`

**Handled events:**

| Event | Behavior |
|-------|----------|
| `checkout.session.completed` | If `mode === subscription`, upserts `UserSubscription` from subscription metadata. |
| `invoice.paid` | Loads plan by `planId` in subscription metadata; grants `creditsGranted` with idempotency on `stripeInvoiceId`. |
| `customer.subscription.updated` / `deleted` | Updates `UserSubscription` status and period fields. |

Subscription metadata is set at Checkout creation (`userId`, `planId`, `ownerClientId`).

---

## 4. Legacy credit top-up (unchanged)

Still available for arbitrary INR amounts (not tied to catalog plans):

- `GET /user/payment/plans` — static amounts + `creditsPerUnit`
- `POST /user/payment/create-intent`
- `POST /user/payment/confirm`
- `GET /user/payment/config`

---

## 5. Manual credits (support)

Existing client/admin endpoint (unchanged):

`POST /client/users/:userId/credits` — see main client API docs.

---

## 6. Environment checklist

| Variable | Purpose |
|----------|---------|
| `STRIPE_MODE` | `test` (default) or `prod` |
| `STRIPE_SECRET_KEY_TEST` / `STRIPE_SECRET_KEY` | Server Stripe secret |
| `STRIPE_PUBLISHABLE_KEY_TEST` / `STRIPE_PUBLISHABLE_KEY` | Client-side Stripe |
| `STRIPE_WEBHOOK_SECRET_*` | Webhook signature |
| `STRIPE_CHECKOUT_SUCCESS_URL` / `STRIPE_CHECKOUT_CANCEL_URL` | Optional defaults for Checkout |

---

## 7. Typical flows (sequence)

### One-time pack

1. `GET /user/subscription-plans` → user picks plan.  
2. `POST /user/payment/by-plan/intent` → Stripe Payment Element / Apple Pay / Google Pay.  
3. On success → `POST /user/payment/by-plan/confirm` with `paymentIntentId`.  
4. User balance: `credits` on user profile or `GET /user/subscription-plans` (`userCredits`).

### Recurring subscription

1. `GET /user/subscription-plans` → choose recurring plan.  
2. `POST /user/payment/by-plan/subscription-checkout` → redirect to `checkoutUrl`.  
3. User pays on Stripe Checkout.  
4. Webhook `invoice.paid` grants credits each period.  
5. `GET /user/subscriptions` to show status.

### Free pack

1. `POST /user/plans/claim-free` with `planId` (only for zero-priced one-time plans).

---

## 8. Data models (reference)

- **SubscriptionPlan** — catalog row per tenant; recurring rows include `stripePriceId`.  
- **UserSubscription** — one row per Stripe subscription.  
- **Credit** — ledger entry; `addedByRole` includes `subscription` for renewals; `stripeInvoiceId` prevents duplicate grants.  
- **PlanRedemption** — tracks free-pack claims (`userId` + `planId` unique).

---

For questions about JWT roles or client `ownerClientId` resolution, see `backend/middleware/auth.js` and existing `/api/client` user-management patterns.
