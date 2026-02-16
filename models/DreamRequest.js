import mongoose from 'mongoose';

const dreamRequestSchema = new mongoose.Schema({
  dreamSymbol: {
    type: String,
    required: true,
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userEmail: {
    type: String,
    required: true,
    trim: true
  },
  userName: {
    type: String,
    trim: true
  },
  additionalDetails: {
    type: String,
    trim: true
  },
  clientId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed', 'Rejected'],
    default: 'Pending'
  },
  adminNotes: {
    type: String,
    trim: true
  },
  completedDreamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SwapnaDecoder'
  },
  notificationSent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
dreamRequestSchema.index({ clientId: 1, status: 1 });
dreamRequestSchema.index({ userId: 1 });
dreamRequestSchema.index({ createdAt: -1 });

const DreamRequest = mongoose.model('DreamRequest', dreamRequestSchema);
export default DreamRequest;
