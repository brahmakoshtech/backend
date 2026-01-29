import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  // Conversation Identification
  conversationId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Participants
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
  
  // Status Management
  status: {
    type: String,
    enum: ['pending', 'accepted', 'active', 'ended', 'rejected', 'cancelled'],
    default: 'pending'
  },
  
  // Partner Acceptance (NEW)
  isAcceptedByPartner: {
    type: Boolean,
    default: false
  },
  acceptedAt: {
    type: Date,
    default: null
  },
  rejectedAt: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    default: null
  },
  
  // User Astrology Data (NEW)
  userAstrologyData: {
    name: { type: String, default: null },
    dateOfBirth: { type: Date, default: null },
    timeOfBirth: { type: String, default: null },
    placeOfBirth: { type: String, default: null },
    zodiacSign: { type: String, default: null },
    moonSign: { type: String, default: null },
    ascendant: { type: String, default: null },
    sunSign: { type: String, default: null },
    rashi: { type: String, default: null },
    nakshatra: { type: String, default: null },
    // Additional astrology details
    additionalInfo: {
      concerns: { type: String, default: null },
      questions: { type: [String], default: [] },
      previousConsultations: { type: Boolean, default: false },
      specificTopics: { type: [String], default: [] }
    }
  },
  
  // Message Tracking
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  lastMessage: {
    content: { type: String, default: null },
    senderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    senderModel: { type: String, default: null },
    createdAt: { type: Date, default: null }
  },
  
  // Unread Counts
  unreadCount: {
    partner: { type: Number, default: 0 },
    user: { type: Number, default: 0 }
  },
  
  // Timestamps
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: {
    type: Date,
    default: null
  },
  cancelledAt: {
    type: Date,
    default: null
  },
  
  // Session Details
  sessionDetails: {
    duration: { type: Number, default: 0 }, // in minutes
    messagesCount: { type: Number, default: 0 },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null }
  },
  
  // Payment Information
  payment: {
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    status: { 
      type: String, 
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    transactionId: { type: String, default: null },
    paidAt: { type: Date, default: null }
  },
  
  // Rating and Feedback
  rating: {
    byUser: {
      stars: { type: Number, min: 0, max: 5, default: null },
      feedback: { type: String, default: null },
      ratedAt: { type: Date, default: null }
    },
    byPartner: {
      stars: { type: Number, min: 0, max: 5, default: null },
      feedback: { type: String, default: null },
      ratedAt: { type: Date, default: null }
    }
  },
  
  // Conversation Type
  conversationType: {
    type: String,
    enum: ['chat', 'call', 'video'],
    default: 'chat'
  },
  
  // Priority/Tags
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  tags: {
    type: [String],
    default: []
  },
  
  // Metadata
  metadata: {
    source: { type: String, default: 'web' }, // web, mobile, api
    deviceType: { type: String, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null }
  },
  
  // Notes (for internal use)
  notes: {
    type: String,
    default: null
  },
  
  // Flags
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: {
    type: Date,
    default: null
  },
  isReported: {
    type: Boolean,
    default: false
  },
  reportReason: {
    type: String,
    default: null
  },
  reportedAt: {
    type: Date,
    default: null
  },
  reportedBy: {
    type: String,
    enum: ['user', 'partner'],
    default: null
  }
}, {
  timestamps: true
});

// Compound indexes for finding conversations
conversationSchema.index({ partnerId: 1, userId: 1 });
conversationSchema.index({ status: 1, lastMessageAt: -1 });
conversationSchema.index({ partnerId: 1, status: 1 });
conversationSchema.index({ userId: 1, status: 1 });
conversationSchema.index({ createdAt: -1 });
conversationSchema.index({ isAcceptedByPartner: 1, status: 1 });

// Virtual for conversation age
conversationSchema.virtual('conversationAge').get(function() {
  return Date.now() - this.createdAt;
});

// Method to calculate session duration
conversationSchema.methods.calculateDuration = function() {
  if (this.endedAt) {
    return Math.round((this.endedAt - this.startedAt) / (1000 * 60)); // in minutes
  }
  return 0;
};

// Method to check if conversation is active
conversationSchema.methods.isActiveConversation = function() {
  return ['accepted', 'active'].includes(this.status);
};

// Ensure virtuals are included in JSON
conversationSchema.set('toJSON', { virtuals: true });
conversationSchema.set('toObject', { virtuals: true });

export default mongoose.model('Conversation', conversationSchema);