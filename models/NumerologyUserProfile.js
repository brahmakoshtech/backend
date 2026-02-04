// src/models/NumerologyUserProfile.js
// Stores numeroReport and numeroTable - fetched ONCE per user (based on name + DOB, doesn't change)

import mongoose from 'mongoose';

const numerologyUserProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  // DOB used for the calculation (from user profile)
  day: { type: Number, required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  numeroReport: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  numeroTable: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

const NumerologyUserProfile = mongoose.model('NumerologyUserProfile', numerologyUserProfileSchema);
export default NumerologyUserProfile;
