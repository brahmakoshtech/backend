import mongoose from 'mongoose';

const chapterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  chapterNumber: {
    type: Number,
    required: true,
    min: 1,
    max: 18,
    unique: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  shlokaCount: {
    type: Number,
    required: true,
    min: 1
  },
  imageUrl: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  }
}, {
  timestamps: true
});

const Chapter = mongoose.model('Chapter', chapterSchema);

export default Chapter;