import express from 'express';
import Stripe from 'stripe';
import { authenticate, authorize } from '../middleware/auth.js';
import User from '../models/User.js';
import Credit from '../models/Credit.js';
import PaymentLog from '../models/PaymentLog.js';

const router = express.Router();

// Credits granted per 100 cents ($1). e.g. 10 = 10 credits per $1
const CREDITS_PER_DOLLAR = Number(process.env.STRIPE_CREDITS_PER_DOLLAR) || 10;
const MIN_AMOUNT_CENTS = 100;  // $1 minimum
const MAX_AMOUNT_CENTS = 9999999;

/**
 * POST /api/user/payment/create-intent
 * Create Stripe PaymentIntent for credits recharge.
 * Body: { amount: number } — amount in dollars (e.g. 10 = $10)
 * Returns: { clientSecret, publishableKey, credits }
 */
router.post('/create-intent', authenticate, authorize('user'), async (req, res) => {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(503).json({ success: false, message: 'Payment service unavailable' });
    }

    const amountDollars = Number(req.body?.amount);
    console.log('[User Payment] create-intent request', {
      userId: req.user._id?.toString(),
      amountDollars,
    });
    if (!amountDollars || isNaN(amountDollars) || amountDollars <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount (in dollars) is required' });
    }

    const amountCents = Math.round(amountDollars * 100);
    if (amountCents < MIN_AMOUNT_CENTS) {
      return res.status(400).json({ success: false, message: `Minimum amount is $${MIN_AMOUNT_CENTS / 100}` });
    }
    if (amountCents > MAX_AMOUNT_CENTS) {
      return res.status(400).json({ success: false, message: 'Amount too large' });
    }

    const credits = Math.floor((amountCents / 100) * CREDITS_PER_DOLLAR);
    const stripe = new Stripe(stripeSecretKey);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: String(req.user._id),
        credits: String(credits),
      },
    });

    await PaymentLog.create({
      userId: req.user._id,
      paymentIntentId: paymentIntent.id,
      event: 'create_intent',
      amountCents,
      credits,
      status: paymentIntent.status,
      metadata: {
        clientIp: req.ip,
        userAgent: req.headers['user-agent'] || null,
      },
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      credits,
      amountCents,
    });
  } catch (error) {
    console.error('[User Payment] Create intent error:', error);
    try {
      await PaymentLog.create({
        userId: req.user?._id,
        event: 'error',
        status: 'create_intent_failed',
        errorMessage: error.message,
        metadata: {
          stage: 'create-intent',
        },
      });
    } catch (_) {}
    res.status(500).json({
      success: false,
      message: 'Failed to create payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * POST /api/user/payment/confirm
 * After frontend confirms payment, verify with Stripe and add credits.
 * Body: { paymentIntentId: string }
 */
router.post('/confirm', authenticate, authorize('user'), async (req, res) => {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(503).json({ success: false, message: 'Payment service unavailable' });
    }

    const { paymentIntentId } = req.body || {};
    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return res.status(400).json({ success: false, message: 'paymentIntentId is required' });
    }

    console.log('[User Payment] confirm request', {
      userId: req.user._id?.toString(),
      paymentIntentId,
    });

    const stripe = new Stripe(stripeSecretKey);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed',
        status: paymentIntent.status,
      });
    }

    const userId = paymentIntent.metadata?.userId;
    const creditsToAdd = parseInt(paymentIntent.metadata?.credits || '0', 10);

    if (!userId || userId !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Payment does not belong to this user' });
    }
    if (creditsToAdd <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid credits amount' });
    }

    const existing = await Credit.findOne({ paymentIntentId });
    if (existing) {
      return res.json({
        success: true,
        message: 'Credits already added',
        data: { creditsAdded: existing.amount, newBalance: (await User.findById(userId).select('credits')).credits },
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const previousBalance = user.credits || 0;
    const newBalance = previousBalance + creditsToAdd;
    user.credits = newBalance;
    await user.save();

    await Credit.create({
      userId: user._id,
      amount: creditsToAdd,
      previousBalance,
      newBalance,
      addedBy: user._id,
      addedByRole: 'payment',
      description: `Credits purchased via Stripe`,
      paymentIntentId,
    });

    await PaymentLog.create({
      userId: user._id,
      paymentIntentId,
      event: 'confirm',
      amountCents: paymentIntent.amount,
      credits: creditsToAdd,
      status: paymentIntent.status,
      metadata: {
        previousBalance,
        newBalance,
      },
    });

    res.json({
      success: true,
      message: 'Credits added successfully',
      data: {
        creditsAdded: creditsToAdd,
        newBalance,
      },
    });
  } catch (error) {
    console.error('[User Payment] Confirm error:', error);
    try {
      await PaymentLog.create({
        userId: req.user?._id,
        event: 'error',
        status: 'confirm_failed',
        errorMessage: error.message,
        metadata: {
          stage: 'confirm',
        },
      });
    } catch (_) {}
    res.status(500).json({
      success: false,
      message: 'Failed to confirm payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/user/payment/config
 * Returns publishable key and credits rate for frontend
 */
router.get('/config', authenticate, authorize('user'), (req, res) => {
  res.json({
    success: true,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    creditsPerDollar: CREDITS_PER_DOLLAR,
    minAmountDollars: MIN_AMOUNT_CENTS / 100,
  });
});

export default router;
