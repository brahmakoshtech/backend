import Stripe from 'stripe';

export const STRIPE_MODE =
  (process.env.STRIPE_MODE || 'test').toLowerCase() === 'prod' ? 'prod' : 'test';

export const getPublishableKey = () => {
  if (STRIPE_MODE === 'prod') {
    return process.env.STRIPE_PUBLISHABLE_KEY_PROD || process.env.STRIPE_PUBLISHABLE_KEY || '';
  }
  return process.env.STRIPE_PUBLISHABLE_KEY_TEST || process.env.STRIPE_PUBLISHABLE_KEY || '';
};

export const getStripeSecretKey = () => {
  if (STRIPE_MODE === 'prod') {
    return process.env.STRIPE_SECRET_KEY_PROD;
  }
  return process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY;
};

const currencyToStripe = (c) => {
  const u = String(c || 'INR').toUpperCase();
  if (u === 'INR') return 'inr';
  if (u === 'USD') return 'usd';
  if (u === 'AED') return 'aed';
  return 'inr';
};

/**
 * Create or replace Stripe Product + recurring Price for a plan.
 * Call when saving a recurring plan. Old price is left in Stripe (inactive) if you deactivate product—optional cleanup omitted.
 */
export async function ensureStripeRecurringPrice(planDoc) {
  const secret = getStripeSecretKey();
  if (!secret) {
    return { ok: false, error: 'Stripe not configured' };
  }
  if (planDoc.billingType !== 'recurring' || !planDoc.billingInterval) {
    return { ok: false, error: 'Plan is not recurring' };
  }

  const stripe = new Stripe(secret);
  const currency = currencyToStripe(planDoc.currency);
  const unitAmount = Math.round(planDoc.offerPriceMinorUnits);
  if (unitAmount < 1) {
    return { ok: false, error: 'offerPriceMinorUnits must be at least 1' };
  }

  let productId = planDoc.stripeProductId;
  if (!productId) {
    const product = await stripe.products.create({
      name: planDoc.name,
      description: planDoc.description || undefined,
      metadata: {
        brahmakoshPlanId: String(planDoc._id),
        ownerClientId: String(planDoc.ownerClient),
      },
    });
    productId = product.id;
  } else {
    await stripe.products.update(productId, {
      name: planDoc.name,
      description: planDoc.description || undefined,
      metadata: {
        brahmakoshPlanId: String(planDoc._id),
        ownerClientId: String(planDoc.ownerClient),
      },
    });
  }

  const recurring = { interval: planDoc.billingInterval };

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency,
    recurring,
    metadata: {
      brahmakoshPlanId: String(planDoc._id),
      ownerClientId: String(planDoc.ownerClient),
    },
  });

  return {
    ok: true,
    stripeProductId: productId,
    stripePriceId: price.id,
  };
}

export function stripeCurrencyFromPlanCurrency(currency) {
  return currencyToStripe(currency);
}
