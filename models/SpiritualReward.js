import mongoose from 'mongoose';

const spiritualRewardSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Reward title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    trim: true
  },
  subcategory: {
    type: String,
    required: [true, 'Subcategory is required'],
    trim: true
  },
  karmaPointsRequired: {
    type: Number,
    required: [true, 'Karma points required is mandatory'],
    min: [0, 'Karma points cannot be negative'],
    default: 0
  },
  numberOfDevotees: {
    type: Number,
    default: 0,
    min: [0, 'Number of devotees cannot be negative']
  },
  devoteeMessage: {
    type: String,
    trim: true,
    maxlength: [500, 'Devotee message cannot exceed 500 characters']
  },
  greetings: {
    type: String,
    trim: true,
    maxlength: [1000, 'Greetings cannot exceed 1000 characters']
  },
  photoUrl: {
    type: String,
    default: null
  },
  photoKey: {
    type: String,
    default: null
  },
  bannerUrl: {
    type: String,
    default: null
  },
  bannerKey: {
    type: String,
    default: null
                                  // trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  clientId: {
    type: String,
    ref: 'Client',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'createdByModel',
    required: true
  },
  createdByModel: {
    type: String,
    required: true,
    enum: ['User', 'Client', 'Admin']
  }
}, {
  timestamps: true
});

// Index for better query performance
spiritualRewardSchema.index({ clientId: 1, isActive: 1 });
spiritualRewardSchema.index({ category: 1, subcategory: 1, clientId: 1 });
spiritualRewardSchema.index({ karmaPointsRequired: 1, clientId: 1 });

export default mongoose.model('SpiritualReward', spiritualRewardSchema);