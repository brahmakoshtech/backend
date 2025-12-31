import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true, // Allows multiple null values
    trim: true
  },
  authMethod: {
    type: String,
    enum: ['email', 'google'],
    default: 'email'
  },
  password: {
    type: String,
    required: false, // Optional for Google sign-in
    validate: {
      validator: function(v) {
        // If password exists, it must be at least 6 characters
        return !v || v.length >= 6;
      },
      message: 'Password must be at least 6 characters long'
    }
  },
  mobile: {
    type: String,
    trim: true,
    unique: true,
    sparse: true // Allows multiple null values
  },
  // Profile fields (for user role registration)
  profile: {
    name: {
      type: String,
      trim: true
    },
    dob: {
      type: Date
    },
    placeOfBirth: {
      type: String,
      trim: true
    },
    timeOfBirth: {
      type: String,
      trim: true
    },
    gowthra: {
      type: String,
      trim: true
    },
    profession: {
      type: String,
      enum: ['student', 'private job', 'business', 'home makers', 'others'],
      trim: true
    }
  },
  profileImage: {
    type: String, // S3 key for profile image
    trim: true
  },
  // Registration flow tracking
  registrationStep: {
    type: Number,
    default: 0, // 0: not started, 1: email verified, 2: mobile verified, 3: profile completed
    enum: [0, 1, 2, 3]
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  mobileVerified: {
    type: Boolean,
    default: false
  },
  // Temporary OTP storage (cleared after verification)
  emailOtp: {
    type: String,
    select: false
  },
  emailOtpExpiry: {
    type: Date,
    select: false
  },
  mobileOtp: {
    type: String,
    select: false
  },
  mobileOtpExpiry: {
    type: Date,
    select: false
  },
  // Relationships
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  loginApproved: {
    type: Boolean,
    default: true // Changed to true - no approval needed for mobile registration
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Skip if password is not modified or doesn't exist
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  
  // Skip hashing if password starts with 'temp_password_' (temporary password)
  if (this.password.startsWith('temp_password_')) {
    return next();
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  // If password is a temporary password, don't allow login
  if (!this.password || this.password.startsWith('temp_password_')) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

const User = mongoose.model('User', userSchema);

export default User;
