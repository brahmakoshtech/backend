# Brahmakosh — Android integration API reference

**Base URL:** `https://<your-host>/api` (example: `http://10.0.2.2:4000/api` for emulator → host machine).

**Auth header (all protected routes):**  
`Authorization: Bearer <JWT>`

**Content-Type:** `application/json` for JSON bodies.

JWT payload includes `userId`, `role` (`user`), and often `clientId` (Mongo ObjectId of the tenant `Client`).

---

## 1. Authentication

### 1.1 Web-style login

| | |
|---|---|
| **Method / path** | `POST /auth/user/login` |
| **Body** | `{ "email": "string", "password": "string" }` |
| **200** | `{ "success": true, "message": "Login successful", "data": { "user": { ... }, "token": "jwt...", "clientId": "CLI-XXXX" \| null, "clientName": "string \| null } }` |
| **400** | `{ "success": false, "message": "Email and password are required" }` |
| **401** | Invalid credentials / inactive account |

### 1.2 Mobile login (recommended for apps)

| | |
|---|---|
| **Method / path** | `POST /mobile/user/login` |
| **Body** | `{ "email": "string", "password": "string", "clientId": "CLI-XXXX" }` optional `clientId` to scope user to a tenant |
| **200** | `{ "success": true, "message": "Login successful", "data": { "user": { ... }, "token": "jwt...", "clientId": "...", "clientName": "..." } }` |
| **400** | Registration incomplete / validation |
| **401** | Invalid credentials |

Use the returned `token` for all calls below.

---

## 2. User profile (includes credit balance)

| | |
|---|---|
| **Method / path** | `GET /mobile/user/profile` |
| **Headers** | `Authorization: Bearer <token>` |
| **Body** | — |
| **200** | `{ "success": true, "data": { "user": { ..., "credits": number, ... }, ... } }` — `credits` is current balance |

---

## 3. Subscription catalog & subscriptions (user)

### 3.1 List enabled plans for the user’s client

| | |
|---|---|
| **Method / path** | `GET /user/subscription-plans` |
| **Headers** | `Authorization: Bearer <token>` (role `user`) |
| **Body** | — |
| **200** | See response shape below |
| **500** | `{ "success": false, "message": "Failed to load plans" }` |

**200 `data` shape:**

```json
{
  "success": true,
  "data": {
    "plans": [
      {
        "_id": "673abc...",
        "id": "673abc...",
        "ownerClient": "673...",
        "name": "Pro pack",
        "description": "",
        "mrpMinorUnits": 99900,
        "offerPriceMinorUnits": 49900,
        "currency": "INR",
        "creditsPerGrant": 500,
        "billingType": "one_time",
        "billingInterval": "month",
        "yearlyExtraCredits": 0,
        "features": ["Feature A"],
        "imageUrl": "",
        "payModel": "premium",
        "isEnabled": true,
        "sortOrder": 0,
        "createdAt": "...",
        "updatedAt": "...",
        "creditsGranted": 500
      }
    ],
    "userCredits": 120,
    "client": {
      "id": "...",
      "clientCode": "CLI-XXXXXX",
      "businessName": "..."
    }
  }
}
```

If the user has no `clientId`, plans may be empty with a message:

```json
{
  "success": true,
  "data": {
    "plans": [],
    "message": "User has no assigned client; no plans to show."
  }
}
```

**Notes:** Amounts use **minor units** (INR/USD/AED: `100` = 1.00). `stripeProductId` / `stripePriceId` are stripped in this response.

---

### 3.2 List active Stripe subscriptions

| | |
|---|---|
| **Method / path** | `GET /user/subscriptions` |
| **Headers** | `Authorization: Bearer <token>` |
| **Body** | — |
| **200** | `{ "success": true, "data": { "subscriptions": [ { "id": "...", "status": "active", "stripeSubscriptionId": "sub_...", "currentPeriodEnd": "ISO date", "cancelAtPeriodEnd": false, "plan": { ... } } ] } }` |

---

## 4. One-time plan purchase (Stripe PaymentIntent)

### 4.1 Create PaymentIntent for a catalog plan

| | |
|---|---|
| **Method / path** | `POST /user/payment/by-plan/intent` |
| **Headers** | `Authorization: Bearer <token>` |
| **Body** | `{ "planId": "<Mongo ObjectId string>" }` |

**200:**

```json
{
  "success": true,
  "clientSecret": "pi_xxx_secret_xxx",
  "publishableKey": "pk_test_...",
  "paymentIntentId": "pi_...",
  "credits": 500,
  "currency": "INR",
  "amountMinorUnits": 49900,
  "plan": {
    "id": "...",
    "name": "Pro pack",
    "billingType": "one_time"
  }
}
```

**Errors:** `400` (invalid `planId`, user not linked to client, zero-price plan — use claim-free), `404` (plan not found / not one-time), `503` (Stripe not configured).

**Android:** Use **Stripe Android SDK** with `clientSecret` + `publishableKey` to collect payment; on success you get `paymentIntentId` (or read from SDK).

---

### 4.2 Confirm plan payment & grant credits

Call after payment succeeds (or to sync server after client-side success).

| | |
|---|---|
| **Method / path** | `POST /user/payment/by-plan/confirm` |
| **Headers** | `Authorization: Bearer <token>` |
| **Body** | `{ "paymentIntentId": "pi_..." }` |

**200:**

```json
{
  "success": true,
  "message": "Credits added successfully",
  "data": {
    "creditsAdded": 500,
    "newBalance": 620
  }
}
```

Idempotent: duplicate calls return success with “Credits already added” when already processed.

**400 examples:**

```json
{ "success": false, "message": "This intent is not a plan purchase; use /api/user/payment/confirm for legacy top-ups" }
```

(use legacy confirm only for old INR top-up intents, not catalog plans).

---

## 5. Recurring subscription (Stripe Checkout)

### 5.1 Get Checkout URL

| | |
|---|---|
| **Method / path** | `POST /user/payment/by-plan/subscription-checkout` |
| **Headers** | `Authorization: Bearer <token>` |
| **Body** | `{ "planId": "<MongoId>", "successUrl": "https://...", "cancelUrl": "https://..." }` |

Both URLs must be absolute `http`/`https`. Alternatively configure server env `STRIPE_CHECKOUT_SUCCESS_URL` and `STRIPE_CHECKOUT_CANCEL_URL` and omit URLs (if your backend sets them).

**200:**

```json
{
  "success": true,
  "checkoutUrl": "https://checkout.stripe.com/...",
  "sessionId": "cs_...",
  "publishableKey": "pk_test_..."
}
```

Open `checkoutUrl` in **Chrome Custom Tab** / WebView. Credits are granted via **Stripe webhook** (`invoice.paid`), not by this response.

**404:** Plan not recurring or missing `stripePriceId` on server.

---

## 6. Free (zero-price) one-time pack

| | |
|---|---|
| **Method / path** | `POST /user/plans/claim-free` |
| **Headers** | `Authorization: Bearer <token>` |
| **Body** | `{ "planId": "<MongoId>" }` |

**200:**

```json
{
  "success": true,
  "message": "Credits granted",
  "data": {
    "creditsAdded": 50,
    "newBalance": 170
  }
}
```

**409:** `{ "success": false, "message": "This free pack was already claimed" }`

---

## 7. Legacy INR credit top-up (not tied to catalog plans)

### 7.1 Config

| | |
|---|---|
| **GET** | `/user/payment/config` |
| **200** | `{ "success": true, "mode": "test" \| "prod", "publishableKey": "pk_...", "minAmountUnits": 500 }` |

### 7.2 Static preset amounts

| | |
|---|---|
| **GET** | `/user/payment/plans` |
| **200** | `{ "success": true, "data": { "mode": "...", "currency": "INR", "creditsPerUnit": 2, "plans": [ { "amount": 500, "credits": 1000 }, ... ] } }` |

### 7.3 Create PaymentIntent (INR only on server)

| | |
|---|---|
| **POST** | `/user/payment/create-intent` |
| **Body** | Either `{ "planAmount": 500 }` (preset rupees) **or** `{ "amount": 600 }` (custom rupees, min 500 except special trial amounts per server rules) |
| **200** | `{ "success": true, "clientSecret": "...", "publishableKey": "...", "credits": number, "amountUnits": number }` |

### 7.4 Confirm legacy payment

| | |
|---|---|
| **POST** | `/user/payment/confirm` |
| **Body** | `{ "paymentIntentId": "pi_..." }` |
| **200** | `{ "success": true, "message": "Credits added successfully", "data": { "creditsAdded": n, "newBalance": n } }` |

---

## 8. Server-only: Stripe webhook

| | |
|---|---|
| **POST** | `/user/payment/webhook` |
| **Auth** | None (Stripe signature). **Not called from the app.** |

---

## 9. Quick decision tree for Android

1. **Login** → `POST /mobile/user/login` → store JWT.  
2. **Show balance** → `GET /mobile/user/profile` or `GET /user/subscription-plans` (`userCredits`).  
3. **List products** → `GET /user/subscription-plans`.  
4. **One-time paid plan** → `POST /user/payment/by-plan/intent` → Stripe SDK → `POST /user/payment/by-plan/confirm`.  
5. **Recurring plan** → `POST /user/payment/by-plan/subscription-checkout` → open `checkoutUrl`.  
6. **Free plan** (`offerPriceMinorUnits === 0`) → `POST /user/plans/claim-free`.  
7. **Custom INR recharge** → `/user/payment/create-intent` + `/user/payment/confirm`.

---

*Generated from Brahmakosh backend routes; keep in sync when APIs change.*
