import express from 'express';
import mongoose from 'mongoose';
import { authenticate, authorize } from '../middleware/auth.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import Client from '../models/Client.js';
import { ensureStripeRecurringPrice } from '../services/stripePlanSync.js';

const router = express.Router();

function resolveOwnerMongoId(req) {
  if (req.user.role === 'client') {
    return req.user._id;
  }
  const raw = req.body?.ownerClientId || req.query?.ownerClientId;
  if (!raw) return null;
  if (!mongoose.isValidObjectId(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

async function resolveOwnerFromCliCode(req) {
  const code = (req.query?.clientCode || req.body?.clientCode || '').trim().toUpperCase();
  if (!code) return null;
  const doc = await Client.findOne({ clientId: code }).select('_id').lean();
  return doc?._id || null;
}

/** List plans for a tenant client (dashboard). */
router.get(
  '/',
  authenticate,
  authorize('client', 'admin', 'super_admin'),
  async (req, res) => {
    try {
      let owner = resolveOwnerMongoId(req);
      if (!owner && (req.user.role === 'admin' || req.user.role === 'super_admin')) {
        owner = await resolveOwnerFromCliCode(req);
      }
      if (!owner) {
        return res.status(400).json({
          success: false,
          message: 'ownerClientId (Mongo ObjectId) or clientCode (e.g. CLI-XXXXXX) is required for admin',
        });
      }

      if (req.user.role === 'client' && owner.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }

      const plans = await SubscriptionPlan.find({ ownerClient: owner })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();

      res.json({
        success: true,
        data: {
          plans: plans.map((p) => ({
            ...p,
            id: p._id,
            creditsGranted: SubscriptionPlan.creditsForGrant(p),
          })),
        },
      });
    } catch (e) {
      console.error('[subscription-plans] list', e);
      res.status(500).json({
        success: false,
        message: 'Failed to list plans',
        error: process.env.NODE_ENV === 'development' ? e.message : undefined,
      });
    }
  }
);

/** Create plan (Stripe recurring price created when billingType is recurring and Stripe is configured). */
router.post('/', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    const owner = resolveOwnerMongoId(req) || (await resolveOwnerFromCliCode(req));
    if (!owner) {
      return res.status(400).json({
        success: false,
        message: 'ownerClientId or clientCode is required',
      });
    }
    if (req.user.role === 'client' && owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const b = req.body || {};
    const doc = new SubscriptionPlan({
      ownerClient: owner,
      name: b.name,
      description: b.description ?? '',
      mrpMinorUnits: Number(b.mrpMinorUnits),
      offerPriceMinorUnits: Number(b.offerPriceMinorUnits),
      currency: String(b.currency || 'INR').toUpperCase(),
      creditsPerGrant: Number(b.creditsPerGrant),
      billingType: b.billingType,
      billingInterval: b.billingType === 'recurring' ? b.billingInterval : undefined,
      yearlyExtraCredits: Number(b.yearlyExtraCredits ?? 0),
      features: Array.isArray(b.features) ? b.features.map(String) : [],
      imageUrl: b.imageUrl ?? '',
      payModel: b.payModel === 'freemium' ? 'freemium' : 'premium',
      isEnabled: b.isEnabled !== false,
      sortOrder: Number(b.sortOrder ?? 0),
    });

    await doc.validate();

    if (doc.billingType === 'recurring') {
      const sync = await ensureStripeRecurringPrice(doc);
      if (!sync.ok) {
        return res.status(400).json({
          success: false,
          message: sync.error || 'Could not create Stripe price. Check Stripe keys and amounts.',
        });
      }
      doc.stripeProductId = sync.stripeProductId;
      doc.stripePriceId = sync.stripePriceId;
    }

    await doc.save();

    res.status(201).json({
      success: true,
      data: { plan: { ...doc.toObject(), id: doc._id, creditsGranted: doc.resolveCreditsPerGrant() } },
    });
  } catch (e) {
    console.error('[subscription-plans] create', e);
    res.status(500).json({
      success: false,
      message: e.message || 'Failed to create plan',
      error: process.env.NODE_ENV === 'development' ? e.message : undefined,
    });
  }
});

router.get('/:id', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid plan id' });
    }
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    if (req.user.role === 'client' && plan.ownerClient.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    res.json({
      success: true,
      data: {
        plan: {
          ...plan.toObject(),
          id: plan._id,
          creditsGranted: plan.resolveCreditsPerGrant(),
        },
      },
    });
  } catch (e) {
    console.error('[subscription-plans] get', e);
    res.status(500).json({ success: false, message: 'Failed to load plan' });
  }
});

router.patch('/:id', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid plan id' });
    }
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    if (req.user.role === 'client' && plan.ownerClient.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const b = req.body || {};
    const prev = {
      name: plan.name,
      offerPriceMinorUnits: plan.offerPriceMinorUnits,
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      billingType: plan.billingType,
    };

    const fields = [
      'name',
      'description',
      'mrpMinorUnits',
      'offerPriceMinorUnits',
      'currency',
      'creditsPerGrant',
      'billingType',
      'billingInterval',
      'yearlyExtraCredits',
      'features',
      'imageUrl',
      'payModel',
      'isEnabled',
      'sortOrder',
    ];
    for (const k of fields) {
      if (b[k] === undefined) continue;
      if (k === 'features' && Array.isArray(b[k])) plan[k] = b[k].map(String);
      else if (k === 'currency') plan[k] = String(b[k]).toUpperCase();
      else if (k === 'payModel') plan[k] = b[k] === 'freemium' ? 'freemium' : 'premium';
      else plan[k] = b[k];
    }

    if (plan.billingType === 'one_time') {
      plan.billingInterval = undefined;
      plan.stripePriceId = null;
      plan.stripeProductId = null;
    }

    await plan.validate();

    const stripeRelevantChanged =
      prev.name !== plan.name ||
      prev.offerPriceMinorUnits !== plan.offerPriceMinorUnits ||
      prev.currency !== plan.currency ||
      prev.billingInterval !== plan.billingInterval ||
      prev.billingType !== plan.billingType;

    if (plan.billingType === 'recurring' && (stripeRelevantChanged || !plan.stripePriceId)) {
      const sync = await ensureStripeRecurringPrice(plan);
      if (!sync.ok) {
        return res.status(400).json({
          success: false,
          message: sync.error || 'Could not sync Stripe price',
        });
      }
      plan.stripeProductId = sync.stripeProductId;
      plan.stripePriceId = sync.stripePriceId;
    }

    await plan.save();

    res.json({
      success: true,
      data: { plan: { ...plan.toObject(), id: plan._id, creditsGranted: plan.resolveCreditsPerGrant() } },
    });
  } catch (e) {
    console.error('[subscription-plans] patch', e);
    res.status(500).json({
      success: false,
      message: e.message || 'Failed to update plan',
    });
  }
});

router.delete('/:id', authenticate, authorize('client', 'admin', 'super_admin'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid plan id' });
    }
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    if (req.user.role === 'client' && plan.ownerClient.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    await SubscriptionPlan.deleteOne({ _id: plan._id });
    res.json({ success: true, message: 'Plan deleted' });
  } catch (e) {
    console.error('[subscription-plans] delete', e);
    res.status(500).json({ success: false, message: 'Failed to delete plan' });
  }
});

export default router;
