import VoiceConfig from '../models/VoiceConfig.js';

/**
 * Default ElevenLabs Voice IDs
 * Male voices (Krishna):
 *   - Adam:   pNInz6obpgDQGcFmaJgB
 *   - Antoni: ErXwobaYiN019PkySvjV
 *   - Arnold: VR6AewLTigWG4xSOukaG
 * Female voices (Rashmi):
 *   - Rachel: 21m00Tcm4TlvDq8ikWAM
 *   - Domi:   AZnzlk1XvdvUeBnXmlld
 *   - Bella:  EXAVITQu4vr4xnSDxMaL
 *
 * Replace the voiceId values below with your actual ElevenLabs Voice IDs
 * from your ElevenLabs account dashboard.
 */

const DEFAULT_VOICES = [
  // ─── Male Voices (Krishna) ────────────────────────────────────────────────
  {
    name: 'krishna1',
    gender: 'male',
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam - deep, confident male voice
    displayName: 'Krishna 1 (Adam)',
    description: 'Deep, confident male voice ideal for spiritual guidance.',
    prompt: 'Give the answer within two lines.',
  },
  {
    name: 'krishna2',
    gender: 'male',
    voiceId: 'ErXwobaYiN019PkySvjV', // Antoni - well-rounded male voice
    displayName: 'Krishna 2 (Antoni)',
    description: 'Well-rounded male voice with a calm and soothing tone.',
    prompt: 'Give the answer within two lines.',
  },
  {
    name: 'krishna3',
    gender: 'male',
    voiceId: 'VR6AewLTigWG4xSOukaG', // Arnold - authoritative male voice
    displayName: 'Krishna 3 (Arnold)',
    description: 'Authoritative and clear male voice.',
    prompt: 'Give the answer within two lines.',
  },

  // ─── Female Voices (Rashmi) ───────────────────────────────────────────────
  {
    name: 'rashmi1',
    gender: 'female',
    voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel - calm female voice
    displayName: 'Rashmi 1 (Rachel)',
    description: 'Calm, composed female voice perfect for meditation guidance.',
    prompt: 'Give the answer within two lines.',
  },
  {
    name: 'rashmi2',
    gender: 'female',
    voiceId: 'AZnzlk1XvdvUeBnXmlld', // Domi - strong female voice
    displayName: 'Rashmi 2 (Domi)',
    description: 'Strong, expressive female voice with clear articulation.',
    prompt: 'Give the answer within two lines.',
  },
  {
    name: 'rashmi3',
    gender: 'female',
    voiceId: 'EXAVITQu4vr4xnSDxMaL', // Bella - soft female voice
    displayName: 'Rashmi 3 (Bella)',
    description: 'Soft, warm female voice with a gentle delivery.',
    prompt: 'Give the answer within two lines.',
  },
];

export const seedVoiceConfigs = async () => {
  try {
    for (const voice of DEFAULT_VOICES) {
      await VoiceConfig.findOneAndUpdate(
        { name: voice.name },
        { $setOnInsert: voice },
        { upsert: true, new: true }
      );
    }
    console.log('[VoiceConfig] ✅ Default voice configurations seeded successfully');
  } catch (err) {
    console.error('[VoiceConfig] ❌ Failed to seed voice configurations:', err.message);
  }
};