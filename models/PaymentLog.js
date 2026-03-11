import mongoose from 'mongoose';

/**
 * PaymentLog
 * Detailed log of user credit top-up payments via Stripe.
 * Helps track flow from backend side.
 */
const paymentLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    paymentIntentId: {
      type: String,
      index: true,
    },
    event: {
      type: String,
      enum: ['create_intent', 'confirm', 'error'],
      required: true,
    },
    amountCents: {
      type: Number,
      default: null,
    },
    credits: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      default: null,
    },
    metadata: {
      type: Object,
      default: {},
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

paymentLogSchema.index({ createdAt: -1 });

const PaymentLog = mongoose.models.PaymentLog || mongoose.model('PaymentLog', paymentLogSchema);
export default PaymentLog;

