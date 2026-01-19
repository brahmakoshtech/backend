import mongoose from 'mongoose';

const expertCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  image: {
    type: String, // S3 URL
    default: null
  },
  imageKey: {
    type: String, // S3 key for deletion
    default: null
  },
  clientId: {
    type: String,
    required: true
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

// Index for better query performance
expertCategorySchema.index({ clientId: 1, isDeleted: 1 });
expertCategorySchema.index({ isActive: 1, isDeleted: 1 });

export default mongoose.model('ExpertCategory', expertCategorySchema);