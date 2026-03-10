import express from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import Agent from '../../models/Agent.js';
import VoiceConfig from '../../models/voiceConfig.js';

const router = express.Router();

/**
 * GET /api/mobile/agents
 * Returns active agents for the logged-in user's client.
 * Auth: user
 */
router.get('/', authenticate, authorize('user'), async (req, res) => {
  try {
    const clientId = req.user?.clientId?._id || req.user?.clientId || req.user?.tokenClientId;
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'Client ID not found for this user',
      });
    }

    const agents = await Agent.find({ clientId, isActive: true }).sort({ createdAt: -1 }).lean();

    const voiceNames = [...new Set(agents.map((a) => a.voiceName).filter(Boolean))];
    const voiceConfigs = await VoiceConfig.find({ name: { $in: voiceNames }, isActive: true })
      .select('name displayName gender voiceId elevenlabsVoiceName modelId voiceSettings prompt isActive')
      .lean();
    const voiceMap = new Map(voiceConfigs.map((v) => [v.name, v]));

    const data = agents.map((a) => ({
      ...a,
      voiceConfig: voiceMap.get(a.voiceName) || null,
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('[Mobile Agents] List agents error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch agents',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

export default router;

