import mongoose from 'mongoose';

const spiritualSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['meditation', 'prayer', 'chanting', 'breathing', 'mindfulness', 'yoga', 'gratitude', 'silence', 'reflection'],
    default: 'meditation'
  },
  title: {
    type: String,
    required: true
  },
  chantingName: {
    type: String,
    required: function() { return this.type === 'chanting'; }
  },
  targetDuration: {
    type: Number, // planned duration in minutes - not required for chanting
    required: function() { return this.type !== 'chanting'; }
  },
  actualDuration: {
    type: Number, // actual completed duration in minutes - not required for chanting
    required: function() { return this.type !== 'chanting'; }
  },
  status: {
    type: String,
    enum: ['completed', 'incomplete', 'interrupted'],
    default: 'completed'
  },
  completionPercentage: {
    type: Number,
    default: 100
  },
  karmaPoints: {
    type: Number,
    default: 0
  },
  emotion: {
    type: String,
    enum: ['happy', 'sad', 'angry', 'afraid', 'loved', 'surprised', 'calm', 'disgusted', 'stressed', 'anxious', 'peaceful', 'grateful', 'hopeful', 'loving', 'serene', 'focused', 'energized', 'centered', 'mindful', 'devoted', 'elevated', 'reverent', 'quiet', 'neutral']
  },
  chantCount: {
    type: Number,
    default: 0
  },
  videoUrl: {
    type: String,
    default: ''
  },
  audioUrl: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  completedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for better query performance
spiritualSessionSchema.index({ userId: 1, createdAt: -1 });
spiritualSessionSchema.index({ userId: 1, type: 1 });

export default mongoose.model('SpiritualSession', spiritualSessionSchema);