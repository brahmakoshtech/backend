import express from 'express';
import Chat from '../../models/Chat.js';
import { authenticate } from '../../middleware/auth.js';
import { getChatCompletion } from '../../utils/openai.js';

const router = express.Router();

router.post('/:chatId/message', authenticate, async (req, res) => {
  try {
    if (req.decodedRole !== 'user' || !req.user) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { chatId } = req.params;
    const { message, avatarName } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    let chat = await Chat.findOne({ _id: chatId, userId: req.user._id });

    if (!chat) {
      chat = new Chat({
        userId: req.user._id,
        title: `Chat with ${avatarName || 'Avatar'}`,
        messages: []
      });
    }

    chat.messages.push({ role: 'user', content: message.trim() });

    // Fetch user profile
    const User = (await import('../../models/User.js')).default;
    const userProfile = await User.findById(req.user._id).select('profile astrology numerology doshas').lean();

    // Set chat title from first user message
    if (chat.messages.length === 1) {
      const firstMessage = message.trim();
      chat.title = firstMessage.length > 50 ? firstMessage.substring(0, 50) + '...' : firstMessage;
    }

    let systemPrompt = `You are ${avatarName || 'a spiritual guide'}, a divine AI avatar providing personalized spiritual guidance. Always respond in English.`;

    if (userProfile) {
      systemPrompt += '\n\nUser Profile:';
      if (userProfile.profile) {
        const p = userProfile.profile;
        if (p.name || p.dob || p.timeOfBirth || p.placeOfBirth) {
          systemPrompt += `\nName: ${p.name || 'N/A'}, Gender: ${p.gender || 'N/A'}`;
          systemPrompt += `\nDOB: ${p.dob ? new Date(p.dob).toLocaleDateString() : 'N/A'}`;
          systemPrompt += `\nBirth Time: ${p.timeOfBirth || 'N/A'}, Place: ${p.placeOfBirth || 'N/A'}`;
          if (p.gowthra) systemPrompt += `\nGowthra: ${p.gowthra}`;
        }
      }
      if (userProfile.astrology && (userProfile.astrology.sunSign || userProfile.astrology.moonSign)) {
        const a = userProfile.astrology;
        systemPrompt += `\n\nAstrology: Sun Sign: ${a.sunSign || 'N/A'}, Moon: ${a.moonSign || 'N/A'}, Ascendant: ${a.ascendant || 'N/A'}`;
        if (a.nakshatraPada) systemPrompt += `, Nakshatra: ${a.nakshatraPada}`;
      }
      if (userProfile.numerology && (userProfile.numerology.lifePathNumber || userProfile.numerology.destinyNumber)) {
        const n = userProfile.numerology;
        systemPrompt += `\n\nNumerology: Life Path: ${n.lifePathNumber || 'N/A'}, Destiny: ${n.destinyNumber || 'N/A'}`;
      }
      if (userProfile.doshas && userProfile.doshas.dominantDosha) {
        const d = userProfile.doshas;
        systemPrompt += `\n\nDoshas: Vata ${d.vata || 0}%, Pitta ${d.pitta || 0}%, Kapha ${d.kapha || 0}%`;
        if (d.dominantDosha) systemPrompt += `, Dominant: ${d.dominantDosha}`;
      }
      if (systemPrompt.includes('User Profile:')) {
        systemPrompt += '\n\nProvide personalized guidance based on this profile.';
      } else {
        systemPrompt += '\n\nNote: User profile is incomplete. Provide general spiritual guidance and encourage them to complete their profile for personalized insights.';
      }
    }

    const openaiMessages = [
      { role: 'system', content: systemPrompt },
      ...chat.messages.map(msg => ({ role: msg.role, content: msg.content }))
    ];

    const aiResponse = await getChatCompletion(openaiMessages);

    chat.messages.push({ role: 'assistant', content: aiResponse.content });
    await chat.save();

    res.json({
      success: true,
      data: {
        chatId: chat._id,
        response: aiResponse.content,
        assistantMessage: { role: 'assistant', content: aiResponse.content }
      }
    });
  } catch (error) {
    console.error('Avatar chat error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
