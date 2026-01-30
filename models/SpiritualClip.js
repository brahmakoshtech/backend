import mongoose from 'mongoose';

const spiritualClipSchema = new mongoose.Schema({
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
  type: {
    type: String,
    required: true,
    enum: ['meditation', 'prayer', 'chanting', 'breathing', 'mindfulness', 'yoga', 'gratitude', 'silence', 'reflection'],
    default: 'meditation'
  },
  videoUrl: {
    type: String,
    default: null
  },
  audioUrl: {
    type: String,
    default: null
  },
  suitableTime: {
    type: String,
    enum: ['morning', 'afternoon', 'evening', 'night', ''],
    default: ''
  },
  guided: {
    type: String,
    enum: ['guided', 'unguided', ''],
    default: ''
  },
  transcript: {
    type: String,
    default: ''
  },
  suitableConfiguration: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SpiritualConfiguration',
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  clientId: {
    type: String,
    required: true
  },
  videoKey: {
    type: String,
    default: null
  },
  audioKey: {
    type: String,
    default: null
  },
  videoFileName: {
    type: String,
    default: null
  },
  audioFileName: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Index for better query performance
spiritualClipSchema.index({ type: 1, isActive: 1 });
spiritualClipSchema.index({ clientId: 1 });
spiritualClipSchema.index({ suitableTime: 1 });
spiritualClipSchema.index({ suitableConfiguration: 1 });

export default mongoose.model('SpiritualClip', spiritualClipSchema);