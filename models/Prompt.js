import mongoose from 'mongoose';

const promptSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  label: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    required: true
  }
}, {
  timestamps: true,
  collection: 'prompts'
});

promptSchema.statics.getOrCreate = async function(key, defaults) {
  const update = {
    $setOnInsert: {
      key,
      label: defaults.label || key,
      description: defaults.description || '',
      content: defaults.content || ''
    }
  };

  const options = {
    new: true,
    upsert: true
  };

  const doc = await this.findOneAndUpdate({ key }, update, options);

  // If document existed and content is empty, fill with defaults (fallback)
  if (!doc.content && defaults.content) {
    doc.content = defaults.content;
    await doc.save();
  }

  return doc;
};

export default mongoose.model('Prompt', promptSchema);
