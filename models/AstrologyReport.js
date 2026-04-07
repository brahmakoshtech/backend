import mongoose from 'mongoose';

const astrologyReportSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    reportType: {
      type: String,
      enum: ['mini', 'basic', 'pro'],
      required: true
    },
    category: {
      type: String,
      enum: ['kundali'],
      default: 'kundali'
    },
    provider: {
      type: String,
      default: 'astrologyapi'
    },
    providerPdfUrl: {
      type: String,
      required: true
    },
    s3Key: {
      type: String,
      required: true
    },
    s3Url: {
      type: String,
      required: true
    },
    language: {
      type: String,
      default: 'en'
    },
    place: {
      type: String
    },
    meta: {
      type: mongoose.Schema.Types.Mixed
    }
  },
  {
    timestamps: true
  }
);

astrologyReportSchema.index({ userId: 1, createdAt: -1 });

const AstrologyReport = mongoose.model('AstrologyReport', astrologyReportSchema);

export default AstrologyReport;

