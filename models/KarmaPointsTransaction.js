import mongoose from 'mongoose';

const karmaPointsTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 1
  },
  previousBalance: {
    type: Number,
    required: true,
    default: 0
  },
  newBalance: {
    type: Number,
    required: true
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'addedByModel',
    required: true
  },
  addedByModel: {
    type: String,
    required: true,
    enum: ['User', 'Client', 'Admin']
  },
  addedByRole: {
    type: String,
    required: true,
    enum: ['client', 'admin', 'super_admin']
  },
  description: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

karmaPointsTransactionSchema.index({ userId: 1, createdAt: -1 });
karmaPointsTransactionSchema.index({ addedBy: 1 });

const KarmaPointsTransaction = mongoose.model('KarmaPointsTransaction', karmaPointsTransactionSchema);

export default KarmaPointsTransaction;
