import mongoose from 'mongoose';

/** Tracks one-time redemptions (e.g. free credit pack claimed once per user per plan). */
const planRedemptionSchema = new mongoose.Schema(
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
    kind: {
      type: String,
      enum: ['free_pack'],
      default: 'free_pack',
    },
  },
  { timestamps: true }
);

planRedemptionSchema.index({ userId: 1, planId: 1 }, { unique: true });

const PlanRedemption =
  mongoose.models.PlanRedemption || mongoose.model('PlanRedemption', planRedemptionSchema);
export default PlanRedemption;
