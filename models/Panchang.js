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
    sunrise: String,
    sunset: String,
    vedicSunrise: String,        // Added
    vedicSunset: String          // Added
  },
  advancedPanchang: {
    day: String,
    sunrise: String,
    sunset: String,
    moonrise: String,
    moonset: String,
    vedicSunrise: String,        // Added
    vedicSunset: String,         // Added
    ayana: String,
    paksha: String,              // Added
    ritu: String,                // Added
    sunSign: String,             // Added
    moonSign: String,            // Added
    panchangYog: String,         // Added
    vikramSamvat: Number,        // Added (changed to Number)
    shakaSamvat: Number,         // Added (changed to Number)
    vkramSamvatName: String,     // Added
    shakaSamvatName: String,     // Added
    dishaShool: String,          // Added
    dishaShoolRemedies: String,  // Added
    nakShool: {                  // Added
      direction: String,
      remedies: String
    },
    moonNivas: String,           // Added
    hinduMaah: {                 // Added
      adhikStatus: Boolean,
      purnimanta: String,
      amanta: String,
      amantaId: Number,
      purnimantaId: Number
    },
    abhijitMuhurta: {
      start: String,
      end: String
    },
    rahukaal: {
      start: String,
      end: String
    },
    guliKaal: {
      start: String,
      end: String
    },
    yamghantKaal: {              // Added (was yamagandaKaal)
      start: String,
      end: String
    },
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
    // When birth data missing - return these instead of generic predictions
    missingFields: [String],
    message: String,
    // API response fields when birth data is complete
    birthMoonSign: String,
    birthMoonNakshatra: String,
    predictionDate: String,
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