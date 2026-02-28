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

// Helper function to update partner rating and review count
async function updatePartnerRating(expertId) {
  try {
    const Partner = mongoose.model('Partner');
    const reviews = await Review.find({ expertId, isActive: true });
    
    const reviewCount = reviews.length;
    const avgRating = reviewCount > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
      : 0;
    
    await Partner.findByIdAndUpdate(expertId, {
      rating: parseFloat(avgRating.toFixed(1)),
      totalRatings: reviewCount
    });
  } catch (error) {
    console.error('Error updating partner rating:', error);
  }
}

// Post-save hook: Update partner rating after review is created
reviewSchema.post('save', async function(doc) {
  await updatePartnerRating(doc.expertId);
});

// Post-remove hook: Update partner rating after review is deleted
reviewSchema.post('remove', async function(doc) {
  await updatePartnerRating(doc.expertId);
});

// Post-findOneAndDelete hook: Update partner rating after review is deleted
reviewSchema.post('findOneAndDelete', async function(doc) {
  if (doc) {
    await updatePartnerRating(doc.expertId);
  }
});

// Post-deleteOne hook: Update partner rating after review is deleted
reviewSchema.post('deleteOne', async function() {
  const doc = await this.model.findOne(this.getFilter());
  if (doc) {
    await updatePartnerRating(doc.expertId);
  }
});

// Post-findOneAndUpdate hook: Update partner rating after review is updated
reviewSchema.post('findOneAndUpdate', async function(doc) {
  if (doc) {
    await updatePartnerRating(doc.expertId);
  }
});

// Pre-findOneAndUpdate hook to handle rating/isActive changes
reviewSchema.pre('findOneAndUpdate', function(next) {
  this._updateTriggered = true;
  next();
});

const Review = mongoose.model('Review', reviewSchema);

export default Review;