import mongoose from 'mongoose';

const aspectSchema = new mongoose.Schema({
  point: {
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

const contextVariationSchema = new mongoose.Schema({
  context: {
    type: String,
    required: true,
    trim: true
  },
  meaning: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const remediesSchema = new mongoose.Schema({
  mantras: {
    type: [String],
    default: []
  },
  pujas: {
    type: [String],
    default: []
  },
  donations: {
    type: [String],
    default: []
  },
  precautions: {
    type: [String],
    default: []
  }
}, { _id: false });

const timeSignificanceSchema = new mongoose.Schema({
  morning: {
    type: String,
    trim: true
  },
  night: {
    type: String,
    trim: true
  },
  brahmaMuhurat: {
    type: String,
    trim: true
  }
}, { _id: false });

const genderSpecificSchema = new mongoose.Schema({
  male: {
    type: String,
    trim: true
  },
  female: {
    type: String,
    trim: true
  },
  common: {
    type: String,
    trim: true
  }
}, { _id: false });

const swapnaDecoderSchema = new mongoose.Schema({
  symbolName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  symbolNameHindi: {
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
  thumbnailUrl: {
    type: String,
    trim: true
  },
  thumbnailKey: {
    type: String,
    trim: true
  },
  shortDescription: {
    type: String,
    trim: true
  },
  detailedInterpretation: {
    type: String,
    trim: true
  },
  positiveAspects: {
    type: [aspectSchema],
    default: []
  },
  negativeAspects: {
    type: [aspectSchema],
    default: []
  },
  contextVariations: {
    type: [contextVariationSchema],
    default: []
  },
  astrologicalSignificance: {
    type: String,
    trim: true
  },
  vedicReferences: {
    type: String,
    trim: true
  },
  remedies: {
    type: remediesSchema,
    default: () => ({})
  },
  relatedSymbols: {
    type: [String],
    default: []
  },
  frequencyImpact: {
    type: String,
    trim: true
  },
  timeSignificance: {
    type: timeSignificanceSchema,
    default: () => ({})
  },
  genderSpecific: {
    type: genderSpecificSchema,
    default: () => ({})
  },
  tags: {
    type: [String],
    default: [],
    index: true
  },
  clientId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active',
    index: true
  },
  sortOrder: {
    type: Number,
    default: 0,
    index: true
  },
  viewCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Compound indexes for better query performance
swapnaDecoderSchema.index({ category: 1, subcategory: 1 });
swapnaDecoderSchema.index({ status: 1, sortOrder: 1 });
swapnaDecoderSchema.index({ clientId: 1, status: 1 });
swapnaDecoderSchema.index({ createdAt: -1 });
swapnaDecoderSchema.index({ tags: 1 });

// Text index for search functionality
swapnaDecoderSchema.index({ 
  symbolName: 'text', 
  symbolNameHindi: 'text', 
  shortDescription: 'text',
  tags: 'text'
});

export default mongoose.model('SwapnaDecoder', swapnaDecoderSchema);
