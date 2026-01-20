import mongoose from 'mongoose';

const liveAvatarSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  agentId: {
    type: String,
    required: true,
    trim: true
  },
  gender: {
    type: String,
    required: true,
    enum: ['Male', 'Female'],
    default: 'Male'
  },
  category: {
    type: String,
    required: true,
    enum: ['Deity', 'Rashami', 'Expert'],
    default: 'Deity'
  },
  link: {
    type: String,
    trim: true
  },
  imageUrl: {
    type: String,
    trim: true
  },
  imageKey: {
    type: String,
    trim: true
  },
  videoUrl: {
    type: String,
    trim: true
  },
  videoKey: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'paused'],
    default: 'paused'
  },
  viewers: {
    type: Number,
    default: 0
  },
  duration: {
    type: String,
    default: '0m'
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

// Static method to get default values
liveAvatarSchema.statics.getDefaults = function() {
  return {
    gender: 'Male',
    category: 'Deity'
  };
};

export default mongoose.model('LiveAvatar', liveAvatarSchema);


