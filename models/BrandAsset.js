import mongoose from 'mongoose';

const brandAssetSchema = new mongoose.Schema({
  headingText: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  brandLogoName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  brandLogoImage: {
    type: String,
    default: null
  },
  brandLogoImageKey: {
    type: String,
    default: null
    // S3 object key for generating presigned URLs
  },
  backgroundLogoImage: {
    type: String,
    default: null
  },
  backgroundLogoImageKey: {
    type: String,
    default: null
    // S3 object key for generating presigned URLs
  },
  webLinkUrl: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^https?:\/\/.+/.test(v);
      },
      message: 'Web link must be a valid URL starting with http:// or https://'
    }
  },
  socialLink: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^https?:\/\/.+/.test(v);
      },
      message: 'Social link must be a valid URL starting with http:// or https://'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  }
}, {
  timestamps: true
});

brandAssetSchema.index({ clientId: 1, createdAt: -1 });
brandAssetSchema.index({ isActive: 1 });

const BrandAsset = mongoose.model('BrandAsset', brandAssetSchema);

export default BrandAsset;