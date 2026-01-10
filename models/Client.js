import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { customAlphabet } from 'nanoid';

// Generate unique client ID (e.g., CLI-ABC123)
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 6);

const clientSchema = new mongoose.Schema({
  // Unique Client ID for user registration
  clientId: {
    type: String,
    unique: true,
    required: true,
    uppercase: true,
    trim: true
  },
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
  // Business Information
  businessName: {
    type: String,
    trim: true
  },
  websiteUrl: {
    type: String,
    trim: true
  },
  gstNumber: {
    type: String,
    trim: true
  },
  panNumber: {
    type: String,
    trim: true
  },
  businessLogo: {
    type: String,
    trim: true
  },
  // Personal Information
  fullName: {
    type: String,
    trim: true
  },
  mobileNumber: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true
  },
  pincode: {
    type: String,
    trim: true
  },
  // Legacy fields (keeping for backward compatibility)
  businessType: {
    type: String,
    trim: true
  },
  contactNumber: {
    type: String,
    trim: true
  },
  // Relationships
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
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

// Generate unique client ID before saving
clientSchema.pre('save', async function(next) {
  // Generate clientId if not exists
  if (!this.clientId) {
    let unique = false;
    let generatedId;
    
    while (!unique) {
      generatedId = `CLI-${nanoid()}`;
      const existing = await mongoose.model('Client').findOne({ clientId: generatedId });
      if (!existing) {
        unique = true;
      }
    }
    
    this.clientId = generatedId;
  }
  
  // Hash password
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  
  next();
});

// Compare password method
clientSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
clientSchema.methods.toJSON = function() {
  const clientObject = this.toObject();
  delete clientObject.password;
  return clientObject;
};

const Client = mongoose.model('Client', clientSchema);

export default Client;