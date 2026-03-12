import mongoose from 'mongoose';

/**
 * Alert / Case raised by mobile user
 * Supports caseType, title, optional description, and attached media files.
 */
const mediaSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    url: { type: String, required: true },
    contentType: { type: String, default: null },
    size: { type: Number, default: null },
  },
  { _id: true }
);

const alertSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    caseType: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    media: {
      type: [mediaSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['new', 'in_review', 'closed'],
      default: 'new',
      index: true,
    },
  },
  { timestamps: true }
);

alertSchema.index({ userId: 1, createdAt: -1 });

const Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);
export default Alert;

