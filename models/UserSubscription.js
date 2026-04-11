import mongoose from 'mongoose';

const userSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SubscriptionPlan',
      required: true,
      index: true,
    },
    ownerClient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
    },
    stripeCustomerId: { type: String, default: null, trim: true },
    stripeSubscriptionId: { type: String, required: true, trim: true, unique: true },
    status: {
      type: String,
      enum: [
        'active',
        'canceled',
        'incomplete',
        'incomplete_expired',
        'past_due',
        'paused',
        'trialing',
        'unpaid',
      ],
      default: 'active',
    },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSubscriptionSchema.index({ userId: 1, planId: 1 });

const UserSubscription =
  mongoose.models.UserSubscription || mongoose.model('UserSubscription', userSubscriptionSchema);
export default UserSubscription;
