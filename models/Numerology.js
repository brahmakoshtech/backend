// src/models/Numerology.js

import mongoose from 'mongoose';

const numerologySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  // Date components for quick lookup
  day: {
    type: Number,
    required: true
  },
  month: {
    type: Number,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  // Numero Report data
  numeroReport: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  // Numero Table data
  numeroTable: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  // Daily Numero Prediction data
  dailyPrediction: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  // API call metadata
  apiCallDate: {
    type: Date,
    default: Date.now
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index for efficient user + date lookups
numerologySchema.index({ userId: 1, date: 1 }, { unique: true });

// Index for date-based queries
numerologySchema.index({ userId: 1, year: 1, month: 1, day: 1 });

// Pre-save middleware to update lastUpdated
numerologySchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

const Numerology = mongoose.model('Numerology', numerologySchema);

export default Numerology;