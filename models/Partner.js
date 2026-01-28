import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const partnerSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    minlength: 6,
    select: false
  },
  authMethod: {
    type: String,
    enum: ['password', 'google', 'firebase', 'email'],
    default: 'password'
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  firebaseId: {
    type: String,
    sparse: true,
    unique: true
  },
  profilePicture: {
    type: String,
    default: null
  },
  phone: {
    type: String,
    sparse: true
  },
  specialization: {
    type: String,
    default: null
  },
  experience: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalSessions: {
    type: Number,
    default: 0
  },
  // Registration flow fields
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  emailOtp: {
    type: String,
    select: false
  },
  emailOtpExpiry: {
    type: Date,
    select: false
  },
  phoneOtp: {
    type: String,
    select: false
  },
  phoneOtpExpiry: {
    type: Date,
    select: false
  },
  phoneOtpMethod: {
    type: String,
    enum: ['sms', 'whatsapp', 'gupshup', 'twilio'],
    select: false
  },
  registrationStep: {
    type: Number,
    default: 0,
    min: 0,
    max: 4
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  clientCode: {
    type: String,
    required: true
  },
  passwordResetToken: {
    type: String,
    select: false
  },
  passwordResetExpires: {
    type: Date,
    select: false
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Hash password before saving
partnerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  if (this.password) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

// Update timestamp
partnerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compare password method
partnerSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Remove sensitive data when converting to JSON
partnerSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.emailOtp;
  delete obj.emailOtpExpiry;
  delete obj.phoneOtp;
  delete obj.phoneOtpExpiry;
  delete obj.phoneOtpMethod;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  
  return obj;
};

export default mongoose.model('Partner', partnerSchema);