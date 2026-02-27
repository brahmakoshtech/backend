import express from 'express';
import VoiceConfig from '../models/VoiceConfig.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voice-config
// Fetch all voice configurations
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { gender } = req.query;
    const filter = gender ? { gender } : {};
    const voices = await VoiceConfig.find(filter).sort({ gender: 1, name: 1 });

    res.json({
      success: true,
      count: voices.length,
      data: voices,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voice-config/:name
// Fetch a single voice configuration by name
// e.g. GET /api/voice-config/krishna1
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:name', async (req, res) => {
  try {
    const voice = await VoiceConfig.findOne({ name: req.params.name });

    if (!voice) {
      return res.status(404).json({ success: false, message: `Voice '${req.params.name}' not found` });
    }

    res.json({ success: true, data: voice });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/voice-config/:name/voice-id
// Update the ElevenLabs voiceId for a specific voice slot
//
// Body: { voiceId: "new_elevenlabs_voice_id", displayName?: "...", description?: "..." }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:name/voice-id', async (req, res) => {
  try {
    const { voiceId, displayName, description, modelId, voiceSettings } = req.body;

    if (!voiceId) {
      return res.status(400).json({ success: false, message: 'voiceId is required' });
    }

    const updateFields = { voiceId };
    if (displayName !== undefined) updateFields.displayName = displayName;
    if (description !== undefined) updateFields.description = description;
    if (modelId !== undefined) updateFields.modelId = modelId;
    if (voiceSettings !== undefined) updateFields.voiceSettings = voiceSettings;

    const voice = await VoiceConfig.findOneAndUpdate(
      { name: req.params.name },
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!voice) {
      return res.status(404).json({ success: false, message: `Voice '${req.params.name}' not found` });
    }

    res.json({ success: true, message: 'Voice ID updated successfully', data: voice });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/voice-config/:name/prompt
// Update the AI prompt for a specific voice slot
//
// Body: { prompt: "Answer in exactly two sentences." }
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:name/prompt', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ success: false, message: 'A non-empty prompt string is required' });
    }

    const voice = await VoiceConfig.findOneAndUpdate(
      { name: req.params.name },
      { $set: { prompt: prompt.trim() } },
      { new: true }
    );

    if (!voice) {
      return res.status(404).json({ success: false, message: `Voice '${req.params.name}' not found` });
    }

    res.json({ success: true, message: 'Prompt updated successfully', data: voice });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/voice-config/:name/prompt/reset
// Reset the prompt back to the default for a specific voice slot
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:name/prompt/reset', async (req, res) => {
  try {
    const DEFAULT_PROMPT = 'Give the answer within two lines.';

    const voice = await VoiceConfig.findOneAndUpdate(
      { name: req.params.name },
      { $set: { prompt: DEFAULT_PROMPT } },
      { new: true }
    );

    if (!voice) {
      return res.status(404).json({ success: false, message: `Voice '${req.params.name}' not found` });
    }

    res.json({ success: true, message: 'Prompt reset to default', data: voice });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/voice-config/:name/toggle
// Toggle isActive flag for a voice slot
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:name/toggle', async (req, res) => {
  try {
    const voice = await VoiceConfig.findOne({ name: req.params.name });

    if (!voice) {
      return res.status(404).json({ success: false, message: `Voice '${req.params.name}' not found` });
    }

    voice.isActive = !voice.isActive;
    await voice.save();

    res.json({
      success: true,
      message: `Voice '${voice.name}' is now ${voice.isActive ? 'active' : 'inactive'}`,
      data: voice,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/voice-config/:name
// Full update of a voice config (admin use)
//
// Body: any fields from the schema
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:name', async (req, res) => {
  try {
    // Prevent changing the name or gender via this route
    const { name: _name, gender: _gender, ...allowedUpdates } = req.body;

    const voice = await VoiceConfig.findOneAndUpdate(
      { name: req.params.name },
      { $set: allowedUpdates },
      { new: true, runValidators: true }
    );

    if (!voice) {
      return res.status(404).json({ success: false, message: `Voice '${req.params.name}' not found` });
    }

    res.json({ success: true, message: 'Voice configuration updated', data: voice });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

export default router;