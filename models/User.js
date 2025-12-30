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
  password: {
    type: String,
    required: true,
    minlength: 6
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
    default: false
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
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
