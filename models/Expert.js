import mongoose from 'mongoose';

const expertSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  experience: {
    type: String,
    required: true,
    trim: true
  },
  expertise: {
    type: String,
    required: true,
    trim: true
  },
  profileSummary: {
    type: String,
    required: true,
    trim: true
  },
  languages: {
    type: [String],
    default: ['Hindi'],
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'At least one language must be selected'
    }
  },
  customLanguage: {
    type: String,
    trim: true,
    default: ''
  },
  profilePhoto: {
    type: String,
    default: null
  },
  profilePhotoKey: {
    type: String,
    default: null
  },
  backgroundBanner: {
    type: String,
    default: null
  },
  backgroundBannerKey: {
    type: String,
    default: null
  },
  chatCharge: {
    type: Number,
    required: true,
    min: 0
  },
  voiceCharge: {
    type: Number,
    required: true,
    min: 0
  },
  videoCharge: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'busy', 'queue'],
    default: 'offline'
  },
  rating: {
    type: Number,
    default: 4.5,
    min: 0,
    max: 5
  },
  reviews: {
    type: Number,
    default: 0,
    min: 0
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExpertCategory',
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

export default mongoose.model('Expert', expertSchema);