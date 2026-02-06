import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const partnerSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    
    trim: true
  },
  // Link partner to a client (used for "experts" created by clients)
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    default: null,
    index: true
  },
  // Optional category (compatible with ExpertCategory usage)
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExpertCategory',
    default: null,
    index: true
  },
  email: {
    type: String,
    
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    default: null
  },
  
  // Profile Information
  profilePicture: {
    type: String,
    default: null
  },
  // S3 key support (used by former Expert routes)
  profilePictureKey: {
    type: String,
    default: null
  },
  backgroundBanner: {
    type: String,
    default: null
  },
  backgroundBannerKey: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    default: null,
    maxlength: 300 // Short bio max 50 words ~300 characters
  },
  
  // Professional Information
  specialization: {
    type: [String],
    default: []
  },
  experience: {
    type: Number,
    default: 0
  },
  experienceRange: {
    type: String,
    enum: ['0-2', '3-5', '6-10', '10+'],
    default: null
  },
  expertise: {
    type: [String],
    default: [] // e.g., ['Vedic Astrology', 'Tarot Reading', 'Numerology']
  },
  expertiseCategory: {
    type: String,
    enum: ['Astrology', 'Vastu', 'Reiki', 'Healer', 'Numerology', 'Others'],
    default: null
  },
  skills: {
    type: [String],
    default: [], // Max 5 skills from predefined list
    validate: {
      validator: function(arr) {
        return arr.length <= 5;
      },
      message: 'Maximum 5 skills allowed'
    }
  },
  languages: {
    type: [String],
    default: [] // e.g., ['English', 'Hindi', 'Telugu']
  },
  qualifications: {
    type: [String],
    default: []
  },
  consultationModes: {
    type: [String],
    enum: ['Call', 'Chat', 'Video'],
    default: [] // e.g., ['Call', 'Chat']
  },
  
  // Location Information
  location: {
    city: {
      type: String,
      default: null
    },
    country: {
      type: String,
      default: null
    },
    coordinates: {
      latitude: {
        type: Number,
        default: null,
        min: -90,
        max: 90
      },
      longitude: {
        type: Number,
        default: null,
        min: -180,
        max: 180
      }
    }
  },
  
  // Ratings and Reviews
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalRatings: {
    type: Number,
    default: 0
  },
  totalSessions: {
    type: Number,
    default: 0
  },
  completedSessions: {
    type: Number,
    default: 0
  },
  
  // Pricing
  pricePerSession: {
    type: Number,
    default: 0
  },
  // Per-mode charges (compatible with Expert model)
  chatCharge: { type: Number, default: 0, min: 0 },
  voiceCharge: { type: Number, default: 0, min: 0 },
  videoCharge: { type: Number, default: 0, min: 0 },
  currency: {
    type: String,
    default: 'INR'
  },
  
  // Availability
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  availabilityPreference: {
    type: [String],
    enum: ['Weekdays', 'Weekends', 'Flexible'],
    default: []
  },
  
  // Online Status Management
  onlineStatus: {
    type: String,
    enum: ['online', 'offline', 'busy'],
    default: 'offline'
  },
  lastActiveAt: {
    type: Date,
    default: null
  },
  lastOnlineAt: {
    type: Date,
    default: null
  },
  
  // Conversation Management
  activeConversationsCount: {
    type: Number,
    default: 0
  },
  maxConversations: {
    type: Number,
    default: 5 // Maximum concurrent conversations
  },
  totalConversations: {
    type: Number,
    default: 0
  },
  
  // Work Schedule
  workingHours: {
    monday: { available: { type: Boolean, default: true }, start: String, end: String },
    tuesday: { available: { type: Boolean, default: true }, start: String, end: String },
    wednesday: { available: { type: Boolean, default: true }, start: String, end: String },
    thursday: { available: { type: Boolean, default: true }, start: String, end: String },
    friday: { available: { type: Boolean, default: true }, start: String, end: String },
    saturday: { available: { type: Boolean, default: true }, start: String, end: String },
    sunday: { available: { type: Boolean, default: false }, start: String, end: String }
  },
  
  // Bank Details (for payments)
  bankDetails: {
    accountNumber: { type: String, default: null },
    ifscCode: { type: String, default: null },
    accountHolderName: { type: String, default: null },
    bankName: { type: String, default: null },
    upiId: { type: String, default: null }
  },
  
  // Verification Documents
  documents: {
    idProof: { type: String, default: null },
    addressProof: { type: String, default: null },
    certificates: { type: [String], default: [] }
  },
  
  // Social Media Links
  socialMedia: {
    website: { type: String, default: null },
    facebook: { type: String, default: null },
    instagram: { type: String, default: null },
    twitter: { type: String, default: null },
    youtube: { type: String, default: null }
  },
  
  // Statistics
  stats: {
    totalEarnings: { type: Number, default: 0 },
    thisMonthEarnings: { type: Number, default: 0 },
    lastMonthEarnings: { type: Number, default: 0 },
    averageSessionDuration: { type: Number, default: 0 }, // in minutes
    responseTime: { type: Number, default: 0 } // average response time in minutes
  },
  
  // Settings
  settings: {
    emailNotifications: { type: Boolean, default: true },
    smsNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    autoAcceptRequests: { type: Boolean, default: false },
    privateProfile: { type: Boolean, default: false }
  },
  
  // Account Status
  isBlocked: {
    type: Boolean,
    default: false
  },
  // Soft delete flag (compatible with Expert model)
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  blockedReason: {
    type: String,
    default: null
  },
  blockedAt: {
    type: Date,
    default: null
  },
  
  // Verification
  verificationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  
  // Reset Password
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },

  // Credits (partner earnings from chat)
  creditsEarnedTotal: {
    type: Number,
    default: 0,
    min: 0
  },
  creditsEarnedBalance: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

// Indexes for performance
partnerSchema.index({ email: 1 });
partnerSchema.index({ isActive: 1, isVerified: 1 });
partnerSchema.index({ onlineStatus: 1 });
partnerSchema.index({ rating: -1, totalSessions: -1 });
partnerSchema.index({ specialization: 1 });
partnerSchema.index({ expertiseCategory: 1 });
partnerSchema.index({ 'location.coordinates.latitude': 1, 'location.coordinates.longitude': 1 }); // For geospatial queries

// Hash password before saving
partnerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
partnerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to check if partner can accept more conversations
partnerSchema.methods.canAcceptConversation = function() {
  return this.activeConversationsCount < this.maxConversations;
};

// Method to update online status based on active conversations
partnerSchema.methods.updateBusyStatus = async function() {
  if (this.activeConversationsCount >= this.maxConversations) {
    this.onlineStatus = 'busy';
  } else if (this.onlineStatus === 'busy' && this.activeConversationsCount < this.maxConversations) {
    this.onlineStatus = 'online';
  }
  await this.save();
};

// Method to increment active conversations
partnerSchema.methods.incrementActiveConversations = async function() {
  this.activeConversationsCount += 1;
  this.totalConversations += 1;
  await this.updateBusyStatus();
};

// Method to decrement active conversations
partnerSchema.methods.decrementActiveConversations = async function() {
  if (this.activeConversationsCount > 0) {
    this.activeConversationsCount -= 1;
    await this.updateBusyStatus();
  }
};

// Virtual for full name (if needed)
partnerSchema.virtual('isAvailable').get(function() {
  return this.onlineStatus === 'online' && this.canAcceptConversation();
});

// Ensure virtuals are included in JSON
partnerSchema.set('toJSON', { virtuals: true });
partnerSchema.set('toObject', { virtuals: true });

export default mongoose.model('Partner', partnerSchema);