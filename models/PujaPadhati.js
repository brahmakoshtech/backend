import mongoose from 'mongoose';

const pujaVidhiSchema = new mongoose.Schema({
  stepNumber: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const samagriItemSchema = new mongoose.Schema({
  itemName: {
    type: String,
    required: true,
    trim: true
  },
  quantity: {
    type: String,
    trim: true
  },
  isOptional: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const mantraSchema = new mongoose.Schema({
  mantraText: {
    type: String,
    required: true,
    trim: true
  },
  meaning: {
    type: String,
    trim: true
  }
}, { _id: false });

const pujaPadhatiSchema = new mongoose.Schema({
  pujaName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  category: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  subcategory: {
    type: String,
    trim: true,
    index: true
  },
  purpose: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  bestDay: {
    type: String,
    trim: true
  },
  duration: {
    type: Number
  },
  language: {
    type: String,
    default: 'Hindi',
    trim: true
  },
  thumbnailUrl: {
    type: String,
    trim: true
  },
  thumbnailKey: {
    type: String,
    trim: true
    // S3 object key for generating presigned URLs
  },
  pujaVidhi: {
    type: [pujaVidhiSchema],
    default: []
  },
  samagriList: {
    type: [samagriItemSchema],
    default: []
  },
  mantras: {
    type: [mantraSchema],
    default: []
  },
  specialInstructions: {
    type: String,
    trim: true
  },
  muhurat: {
    type: String,
    trim: true
  },
  audioUrl: {
    type: String,
    trim: true
  },
  audioKey: {
    type: String,
    trim: true
    // S3 object key for generating presigned URLs
  },
  videoUrl: {
    type: String,
    trim: true
  },
  videoKey: {
    type: String,
    trim: true
    // S3 object key for generating presigned URLs
  },
  clientId: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Draft', 'Active', 'Inactive'],
    default: 'Active',
    index: true
  },
  sortOrder: {
    type: Number,
    default: 0,
    index: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
pujaPadhatiSchema.index({ category: 1, subcategory: 1 });
pujaPadhatiSchema.index({ status: 1, sortOrder: 1 });
pujaPadhatiSchema.index({ createdAt: -1 });
pujaPadhatiSchema.index({ clientId: 1 });

export default mongoose.model('PujaPadhati', pujaPadhatiSchema);
