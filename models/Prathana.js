import mongoose from 'mongoose';

const prathanaSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  text: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Morning Prayer', 'Evening Prayer', 'Gratitude Prayer', 'Peace Prayer', 'Healing Prayer', 'Protection Prayer'],
    trim: true
  },
  duration: {
    type: Number,
    required: true,
    min: 1
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
  thumbnailUrl: {
    type: String,
    trim: true
  },
  thumbnailKey: {
    type: String,
    trim: true
    // S3 object key for generating presigned URLs
  },
  youtubeLink: {
    type: String,
    trim: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

export default mongoose.model('Prathana', prathanaSchema);