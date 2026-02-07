import mongoose from 'mongoose';

const rewardRedemptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rewardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SpiritualReward',
    required: true
  },
  karmaPointsSpent: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'completed'
  },
  clientId: {
    type: String,
    required: true
  },
  redeemedAt: {
    type: Date,
    default: Date.now
  }
});

rewardRedemptionSchema.index({ userId: 1, redeemedAt: -1 });
rewardRedemptionSchema.index({ clientId: 1 });

const RewardRedemption = mongoose.model('RewardRedemption', rewardRedemptionSchema);

export default RewardRedemption;
