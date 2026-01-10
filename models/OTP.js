import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: false, // Optional - not required for email OTPs
    trim: true
  },
  email: {
    type: String,
    required: false, // Optional - not required for mobile OTPs
    trim: true,
    lowercase: true
  },
  otp: {
    type: String,
    required: true
  },
  client: {
    type: String,
    default: 'brahmakosh'
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  
  type: {
    type: String,
    enum: ['email', 'mobile', 'whatsapp', 'sms', 'gupshup'],
    default: 'mobile'
  },
  // Session identifier for password reset OTPs (no unique index)
  sessionId: {
    type: String,
    required: false,
    trim: true,
    sparse: true
  }
}, {
  timestamps: true
});

// Custom validation: At least one of mobile or email must be provided
otpSchema.pre('validate', function(next) {
  if (!this.mobile && !this.email) {
    this.invalidate('mobile', 'Either mobile or email is required');
    this.invalidate('email', 'Either mobile or email is required');
  }
  next();
});

// Index for faster lookups (sparse indexes to handle null values)
otpSchema.index({ mobile: 1, otp: 1, isUsed: 1 }, { sparse: true });
otpSchema.index({ email: 1, otp: 1, isUsed: 1 }, { sparse: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired OTPs

const OTP = mongoose.model('OTP', otpSchema);

export default OTP;

