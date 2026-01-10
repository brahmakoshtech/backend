import mongoose from 'mongoose';

console.log('FounderMessage model loaded');

const founderMessageSchema = new mongoose.Schema({
  founderName: {
    type: String,
    required: true,
    trim: true
  },
  position: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  founderImage: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft'
  },
  views: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('FounderMessage', founderMessageSchema);