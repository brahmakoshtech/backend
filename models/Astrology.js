// src/models/Astrology.js

import mongoose from 'mongoose';

const planetSchema = new mongoose.Schema({
  id: Number,
  name: String,
  fullDegree: Number,
  normDegree: Number,
  speed: Number,
  isRetro: String,
  sign: String,
  signLord: String,
  nakshatra: String,
  nakshatraLord: String,
  nakshatra_pad: Number,
  house: Number,
  is_planet_set: Boolean,
  planet_awastha: String
}, { _id: false });

const astrologySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  birthDetails: {
    day: Number,
    month: Number,
    year: Number,
    hour: Number,
    minute: Number,
    latitude: Number,
    longitude: Number,
    ayanamsha: Number,
    sunrise: String,
    sunset: String
  },
  astroDetails: {
    ascendant: String,
    sign: String,
    signLord: String,
    nakshatra: String,
    nakshatraLord: String,
    charan: String,
    varna: String,
    gan: String,
    yoni: String,
    nadi: String
  },
  planets: [planetSchema],
  planetsExtended: [planetSchema],
  birthChart: {
    houses: {
      type: Map,
      of: [String]
    }
  },
  birthExtendedChart: {
    houses: {
      type: Map,
      of: [String]
    }
  },
  // Metadata for tracking
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

// Update timestamp before saving
astrologySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for faster queries
astrologySchema.index({ userId: 1 });

const Astrology = mongoose.model('Astrology', astrologySchema);

export default Astrology;