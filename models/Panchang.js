// src/models/Panchang.js

import mongoose from 'mongoose';

const panchangSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  dateKey: {
    type: String,
    required: true,
    // Format: YYYY-MM-DD (e.g., "2026-01-24")
  },
  requestDate: {
    type: Date,
    required: true
  },
  location: {
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180
    }
  },
  basicPanchang: {
    day: String,
    tithi: String,
    nakshatra: String,
    yog: String,
    karan: String,
    paksha: String,
    ritu: String,
    month: String,
    moonSign: String,
    sunSign: String,
    ayanamsha: Number,
    vikramSamvat: String,
    shakaSamvat: String,
    vkramSamvatName: String,
    shakaSamvatName: String,
    dishaShool: String,
    dishaShoolRemedies: String,
    kundliMuhurta: String,
    rahukaal: String,
    guliKaal: String,
    yamagandaKaal: String,
    abhijitMuhurta: String,
    sunrise: String,
    sunset: String,
    moonrise: String,
    moonset: String
  },
  advancedPanchang: {
    sunrise: String,
    sunset: String,
    moonrise: String,
    moonset: String,
    sunSignChange: String,
    moonSignChange: String,
    ayana: String,
    panchang: {
      tithi: mongoose.Schema.Types.Mixed,
      nakshatra: mongoose.Schema.Types.Mixed,
      yog: mongoose.Schema.Types.Mixed,
      karan: mongoose.Schema.Types.Mixed
    }
  },
  chaughadiyaMuhurta: {
    day: [mongoose.Schema.Types.Mixed],
    night: [mongoose.Schema.Types.Mixed]
  },
  dailyNakshatraPrediction: {
    nakshatra: String,
    prediction: mongoose.Schema.Types.Mixed,
    bot_response: String,
    mood: String,
    mood_percentage: String,
    lucky_color: [String],
    lucky_number: [Number],
    lucky_time: String
  },
  lastCalculated: {
    type: Date,
    default: Date.now
  },
  calculationSource: {
    type: String,
    enum: ['api', 'manual'],
    default: 'api'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for userId and dateKey (unique combination)
panchangSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

// Index for cleanup queries
panchangSchema.index({ requestDate: 1 });

// Update timestamp before saving
panchangSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Panchang = mongoose.model('Panchang', panchangSchema);

export default Panchang;