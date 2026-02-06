import mongoose from 'mongoose';

/**
 * ConversationSession - lightweight table for fast session tracking
 * Stores session summary for each ended conversation.
 * Used for quick lookups, analytics, and history without loading full Conversation.
 */
const conversationSessionSchema = new mongoose.Schema({
  conversationId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  startTime: {
    type: Date,
    required: true,
    index: true
  },
  endTime: {
    type: Date,
    required: true,
    index: true
  },
  duration: {
    type: Number,
    default: 0
  },
  messagesCount: {
    type: Number,
    default: 0
  },
  creditsUsed: {
    type: Number,
    default: 0
  },
  rating: {
    byUser: {
      stars: { type: Number, min: 0, max: 5, default: null },
      feedback: { type: String, default: null },
      satisfaction: { type: String, default: null },
      ratedAt: { type: Date, default: null }
    },
    byPartner: {
      stars: { type: Number, min: 0, max: 5, default: null },
      feedback: { type: String, default: null },
      satisfaction: { type: String, default: null },
      ratedAt: { type: Date, default: null }
    }
  }
}, {
  timestamps: true,
  collection: 'conversationsessions'
});

conversationSessionSchema.index({ partnerId: 1, endTime: -1 });
conversationSessionSchema.index({ userId: 1, endTime: -1 });
conversationSessionSchema.index({ endTime: -1 });

export default mongoose.model('ConversationSession', conversationSessionSchema);
