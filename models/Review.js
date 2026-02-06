import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  expertId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    required: true
  },
  userName: {
    type: String,
    required: true,
    trim: true
  },
  userImage: {
    type: String,
    default: null
  },
  userImageKey: {
    type: String,
    default: null
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  consultationType: {
    type: String,
    enum: ['Chat', 'Voice', 'Video'],
    default: 'Chat'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
reviewSchema.index({ expertId: 1, isActive: 1 });
reviewSchema.index({ createdBy: 1 });

const Review = mongoose.model('Review', reviewSchema);

export default Review;