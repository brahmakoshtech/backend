import mongoose from 'mongoose';

const sankalpSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  subcategory: {
    type: String,
    trim: true
  },
  durationType: {
    type: String,
    enum: ['Fixed', 'Custom'],
    default: 'Fixed'
  },
  totalDays: {
    type: Number,
    required: true,
    min: 1
  },
  completionRule: {
    type: String,
    enum: ['Daily', 'Alternate'],
    default: 'Daily'
  },
  karmaPointsPerDay: {
    type: Number,
    default: 5,
    min: 0
  },
  completionBonusKarma: {
    type: Number,
    default: 50,
    min: 0
  },
  bannerImage: {
    type: String,
    trim: true
  },
  bannerImageKey: {
    type: String,
    trim: true
  },
  dailyMotivationMessage: {
    type: String,
    trim: true
  },
  completionMessage: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['Draft', 'Active', 'Inactive'],
    default: 'Active'
  },
  visibility: {
    type: String,
    enum: ['Public', 'Private'],
    default: 'Public'
  },
  slug: {
    type: String,
    trim: true,
    lowercase: true
  },
  participantsCount: {
    type: Number,
    default: 0
  },
  completedCount: {
    type: Number,
    default: 0
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  }
}, {
  timestamps: true
});

// Auto-generate slug from title if not provided
sankalpSchema.pre('save', function(next) {
  if (!this.slug && this.title) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

export default mongoose.model('Sankalp', sankalpSchema);
