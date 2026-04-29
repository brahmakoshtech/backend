import express from 'express';
import mongoose from 'mongoose';
import FounderMessage from '../../models/FounderMessage.js';
import Client from '../../models/Client.js';
import multer from 'multer';
import { uploadFile, deleteFile, getPresignedUrl } from '../../utils/storage.js';
import { authenticate } from '../../middleware/auth.js';

console.log('FounderMessage CRUD routes loaded');

const router = express.Router();

const resolveClientObjectId = async (candidate) => {
  if (!candidate) return null;
  if (mongoose.Types.ObjectId.isValid(candidate)) return candidate;
  const client = await Client.findOne({ clientId: candidate }).select('_id');
  return client?._id || null;
};

const withClientIdString = (doc) => {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  
  // If clientId is populated with Client document
  if (obj.clientId && typeof obj.clientId === 'object') {
    // Extract clientId string field (CLI-ABC123 format)
    if (obj.clientId.clientId) {
      return { ...obj, clientId: obj.clientId.clientId };
    }
    // Fallback: If clientId field missing in Client document
    console.warn('Client document missing clientId field:', obj.clientId._id);
    return { ...obj, clientId: null };
  }
  
  return obj;
};

// Helper function to extract clientId from request (supports both client and user tokens)
const getClientId = async (req) => {
  if (req.user.role === 'user') {
    const rawClientId = req.decodedClientId || req.user.clientId?._id || req.user.clientId || req.user.tokenClientId || req.user.clientId?.clientId;
    const clientId = await resolveClientObjectId(rawClientId);
    if (!clientId) {
      throw new Error('Client ID not found for user token. Please ensure your token includes clientId.');
    }
    return clientId;
  }
  const rawClientId = req.user._id || req.user.id || req.user.clientId;
  const clientId = await resolveClientObjectId(rawClientId);
  if (!clientId) {
    throw new Error('Client ID not found. Please login again.');
  }
  return clientId;
};

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// GET all founder messages
router.get('/', authenticate, async (req, res) => {
  try {
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    // Build query - exclude deleted items, optionally include inactive items
    const query = { clientId: clientId, isDeleted: false };
    if (req.query.includeInactive !== 'true') {
      query.isActive = true;
    }
    
    const messages = await FounderMessage.find(query)
      .populate('clientId', 'clientId')
      .sort({ createdAt: -1 });
    
    // Generate presigned URLs for images
    const messagesWithUrls = await Promise.all(
      messages.map(async (message) => {
        const messageObj = withClientIdString(message);
        if (messageObj.founderImageKey || messageObj.founderImage) {
          try {
            const imageKey = messageObj.founderImageKey || extractS3KeyFromUrl(messageObj.founderImage);
            if (imageKey) {
              messageObj.founderImage = await getPresignedUrl(imageKey, 604800);
            }
          } catch (error) {
            console.error('Error generating image presigned URL:', error);
          }
        }
        return messageObj;
      })
    );
    
    res.json({ success: true, data: messagesWithUrls, count: messagesWithUrls.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single founder message
router.get('/:id', authenticate, async (req, res) => {
  try {
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    const message = await FounderMessage.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false,
      isActive: true
    }).populate('clientId', 'clientId');
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    const messageObj = withClientIdString(message);
    if (messageObj.founderImageKey || messageObj.founderImage) {
      try {
        const imageKey = messageObj.founderImageKey || extractS3KeyFromUrl(messageObj.founderImage);
        if (imageKey) {
          messageObj.founderImage = await getPresignedUrl(imageKey, 604800);
        }
      } catch (error) {
        console.error('Error generating image presigned URL:', error);
      }
    }
    
    res.json({ success: true, data: messageObj });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// CREATE new founder message (without image)
router.post('/', authenticate, async (req, res) => {
  try {
    const { founderName, position, content, status } = req.body;
    
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    // Ensure user has permission (client or user role)
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client or user role required.'
      });
    }
    
    // Validate required fields
    if (!founderName || !position || !content) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: founderName, position, and content are required' 
      });
    }
    
    const newMessage = new FounderMessage({
      founderName,
      position,
      content,
      founderImage: null,
      status: status || 'draft',
      clientId: clientId
    });
    
    const savedMessage = await newMessage.save();
    await savedMessage.populate('clientId', 'clientId');
    res.status(201).json({ success: true, data: withClientIdString(savedMessage) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Upload image for founder message
router.post('/:id/upload-image', authenticate, upload.single('founderImage'), async (req, res) => {
  try {
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const message = await FounderMessage.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false,
      isActive: true
    }).populate('clientId', 'clientId');
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Upload image to S3
    const uploadResult = await uploadFile(req.file, 'founder-messages');
    const imageUrl = uploadResult.url;
    const imageKey = uploadResult.key;

    // Update message with image URL and key
    message.founderImage = imageUrl;
    message.founderImageKey = imageKey;
    await message.save();

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        imageUrl: imageUrl,
        clientId: message.clientId?.clientId || message.clientId
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
});

// UPDATE founder message
router.put('/:id', authenticate, upload.single('founderImage'), async (req, res) => {
  try {
    const { founderName, position, content, status } = req.body;
    
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    // Ensure user has permission (client or user role)
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client or user role required.'
      });
    }
    
    const message = await FounderMessage.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false,
      isActive: true
    });
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    let founderImageUrl = message.founderImage;
    
    // Upload new image if provided (exactly like testimonials)
    if (req.file) {
      // Delete old image from S3 if exists
      if (message.founderImage) {
        try {
          await deleteFile(message.founderImage);
        } catch (deleteError) {
          console.warn('Failed to delete old image:', deleteError);
        }
      }
      
      const uploadResult = await uploadFile(req.file, 'founder-messages');
      founderImageUrl = uploadResult.url;
      updateData.founderImageKey = uploadResult.key;
    }
    
    const updateData = {};
    
    // Only add fields that are provided
    if (founderName !== undefined) updateData.founderName = founderName;
    if (position !== undefined) updateData.position = position;
    if (content !== undefined) updateData.content = content;
    if (founderImageUrl !== undefined) updateData.founderImage = founderImageUrl;
    if (status !== undefined && status !== null && status !== '') updateData.status = status;
    
    const updatedMessage = await FounderMessage.findOneAndUpdate(
      {
        _id: req.params.id,
        clientId: clientId,
        isDeleted: false,
        isActive: true
      },
      updateData,
      { new: true, runValidators: false }
    ).populate('clientId', 'clientId');
    
    if (!updatedMessage) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    res.json({ success: true, data: withClientIdString(updatedMessage) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// DELETE founder message (soft delete)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    // Ensure user has permission (client or user role)
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client or user role required.'
      });
    }
    
    const message = await FounderMessage.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false
    });
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    // Soft delete (set isDeleted to true)
    message.isDeleted = true;
    await message.save();
    
    res.json({ success: true, message: 'Message deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// TOGGLE status (publish/unpublish)
router.patch('/:id/toggle-status', authenticate, async (req, res) => {
  try {
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    // Ensure user has permission (client or user role)
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client or user role required.'
      });
    }
    
    const message = await FounderMessage.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false
    }).populate('clientId', 'clientId');
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    message.status = message.status === 'published' ? 'draft' : 'published';
    const updatedMessage = await message.save();
    
    res.json({ success: true, data: withClientIdString(updatedMessage) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// TOGGLE enable/disable (isActive)
router.patch('/:id/toggle', authenticate, async (req, res) => {
  try {
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    // Ensure user has permission (client or user role)
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client or user role required.'
      });
    }
    
    const message = await FounderMessage.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false
    }).populate('clientId', 'clientId');
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    message.isActive = !message.isActive;
    const updatedMessage = await message.save();
    
    res.json({ 
      success: true, 
      data: withClientIdString(updatedMessage),
      message: `Founder message ${updatedMessage.isActive ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// INCREMENT views (public endpoint - no auth required for viewing)
router.patch('/:id/view', async (req, res) => {
  try {
    const message = await FounderMessage.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    res.json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;