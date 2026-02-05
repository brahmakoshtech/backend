import mongoose from 'mongoose';

const spiritualConfigurationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    maxlength: 100,
    trim: true
  },
  description: {
    type: String,
    required: true,
    maxlength: 500,
    trim: true
  },
  duration: {
    type: String,
    required: true,
    enum: ['1 minute', '2 minutes', '3 minutes', '4 minutes', '5 minutes', '6 minutes', '7 minutes', '8 minutes', '9 minutes', '10 minutes'],
    default: '5 minutes'
  },
  type: {
    type: String,
    required: true,
    enum: ['meditation', 'prayer', 'chanting', 'breathing', 'mindfulness', 'yoga', 'gratitude', 'silence', 'reflection'],
    default: 'meditation'
  },
  emotion: {
    type: String,
    enum: ['happy', 'sad', 'angry', 'afraid', 'loved', 'surprised', 'calm', 'disgusted', 'neutral', 'stressed', ''],
    default: ''
  },
  karmaPoints: {
    type: Number,
    min: 1,
    max: 100,
    default: 10
  },
  chantingType: {
    type: String,
    default: ''
  },
  customChantingType: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  clientId: {
    type: String,
    required: true
  },
  categoryId: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for better query performance
spiritualConfigurationSchema.index({ type: 1, isActive: 1 });
spiritualConfigurationSchema.index({ clientId: 1 });
spiritualConfigurationSchema.index({ clientId: 1, isDeleted: 1 });
spiritualConfigurationSchema.index({ categoryId: 1 });

export default mongoose.model('SpiritualConfiguration', spiritualConfigurationSchema);