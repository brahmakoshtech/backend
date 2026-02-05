// backend/models/Credit.js
// Tracks credit transactions for users (admin/client can add credits)

import mongoose from 'mongoose';

const creditSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Positive amounts = credits added. (Future: negative for deductions.)
    amount: {
      type: Number,
      required: true,
    },
    previousBalance: {
      type: Number,
      required: true,
    },
    newBalance: {
      type: Number,
      required: true,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin', // could be Client or Admin; we also store role
      required: true,
    },
    addedByRole: {
      type: String,
      enum: ['admin', 'super_admin', 'client'],
      required: true,
    },
    description: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

creditSchema.index({ userId: 1, createdAt: -1 });

const Credit = mongoose.model('Credit', creditSchema);
export default Credit;

