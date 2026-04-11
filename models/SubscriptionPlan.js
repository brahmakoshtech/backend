import mongoose from 'mongoose';

/**
 * Per-client credit packs and recurring subscription definitions.
 * Amounts are stored in the smallest currency unit (USD/AED/INR: 100 = 1.00 major).
 */
const subscriptionPlanSchema = new mongoose.Schema(
  {
    ownerClient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', trim: true, maxlength: 2000 },
    mrpMinorUnits: { type: Number, required: true, min: 0 },
    offerPriceMinorUnits: { type: Number, required: true, min: 0 },
    currency: {
      type: String,
      required: true,
      enum: ['USD', 'AED', 'INR'],
      uppercase: true,
    },
    /** Credits granted each billing cycle (recurring) or once (one_time). */
    creditsPerGrant: { type: Number, required: true, min: 0 },
    billingType: {
      type: String,
      required: true,
      enum: ['one_time', 'recurring'],
    },
    /** Required when billingType is recurring (month | year). Omitted for one_time. */
    billingInterval: {
      type: String,
      enum: ['month', 'year'],
    },
    /** Added to creditsPerGrant when billingInterval is year. */
    yearlyExtraCredits: { type: Number, default: 0, min: 0 },
    features: [{ type: String, trim: true }],
    imageUrl: { type: String, default: '', trim: true },
    payModel: {
      type: String,
      enum: ['freemium', 'premium'],
      default: 'premium',
    },
    isEnabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    stripeProductId: { type: String, default: null, trim: true },
    stripePriceId: { type: String, default: null, trim: true, index: true },
  },
  { timestamps: true }
);

subscriptionPlanSchema.index({ ownerClient: 1, isEnabled: 1, sortOrder: 1 });

subscriptionPlanSchema.pre('validate', function (next) {
  if (this.billingType === 'recurring' && !this.billingInterval) {
    return next(new Error('billingInterval is required for recurring plans'));
  }
  if (this.billingType === 'one_time') {
    this.billingInterval = undefined;
  }
  next();
});

/** Credits to grant for this plan (includes yearly bonus when applicable). */
subscriptionPlanSchema.statics.creditsForGrant = function (plain) {
  let base = Number(plain?.creditsPerGrant) || 0;
  if (plain?.billingInterval === 'year' && Number(plain?.yearlyExtraCredits) > 0) {
    base += Number(plain.yearlyExtraCredits);
  }
  return Math.floor(base);
};

subscriptionPlanSchema.methods.resolveCreditsPerGrant = function () {
  return this.constructor.creditsForGrant(this.toObject ? this.toObject() : this);
};

subscriptionPlanSchema.methods.toPublicJSON = function () {
  const o = this.toObject();
  delete o.stripeProductId;
  delete o.stripePriceId;
  o.id = o._id;
  o.creditsGranted = this.resolveCreditsPerGrant();
  return o;
};

const SubscriptionPlan =
  mongoose.models.SubscriptionPlan || mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
export default SubscriptionPlan;
