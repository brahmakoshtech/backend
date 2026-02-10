import mongoose from 'mongoose';

/**
 * AppSettings - single-document store for app-wide settings (e.g. API keys).
 * Used for Gemini API key and other configurable keys manageable from admin dashboard.
 */
const appSettingsSchema = new mongoose.Schema({
  geminiApiKey: {
    type: String,
    default: null,
    trim: true
  }
}, {
  timestamps: true,
  collection: 'appsettings'
});

// Ensure only one document exists (singleton)
appSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

export default mongoose.model('AppSettings', appSettingsSchema);
