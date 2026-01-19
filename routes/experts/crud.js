import express from 'express';
import mongoose from 'mongoose';
import Expert from '../../models/Expert.js';
import Client from '../../models/Client.js';
import multer from 'multer';
import { uploadToS3, deleteFromS3, getobject, extractS3KeyFromUrl } from '../../utils/s3.js';
import { authenticate } from '../../middleware/auth.js';

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
  
  if (obj.clientId && typeof obj.clientId === 'object') {
    if (obj.clientId.clientId) {
      return { ...obj, clientId: obj.clientId.clientId };
    }
    console.warn('Client document missing clientId field:', obj.clientId._id);
    return { ...obj, clientId: null };
  }
  
  return obj;
};

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

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// GET all experts
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
    
    const query = { clientId: clientId, isDeleted: false };
    if (req.query.includeInactive !== 'true') {
      query.isActive = true;
    }
    
    const experts = await Expert.find(query)
      .populate('clientId', 'clientId')
      .sort({ createdAt: -1 });
    
    const expertsWithUrls = await Promise.all(
      experts.map(async (expert) => {
        const expertObj = withClientIdString(expert);
        if (expertObj.profilePhotoKey || expertObj.profilePhoto) {
          try {
            const imageKey = expertObj.profilePhotoKey || extractS3KeyFromUrl(expertObj.profilePhoto);
            if (imageKey) {
              expertObj.profilePhoto = await getobject(imageKey, 604800);
            }
          } catch (error) {
            console.error('Error generating profile photo presigned URL:', error);
          }
        }
        if (expertObj.backgroundBannerKey || expertObj.backgroundBanner) {
          try {
            const imageKey = expertObj.backgroundBannerKey || extractS3KeyFromUrl(expertObj.backgroundBanner);
            if (imageKey) {
              expertObj.backgroundBanner = await getobject(imageKey, 604800);
            }
          } catch (error) {
            console.error('Error generating banner presigned URL:', error);
          }
        }
        return expertObj;
      })
    );
    
    res.json({ success: true, data: expertsWithUrls, count: expertsWithUrls.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single expert
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
    
    const expert = await Expert.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false,
      isActive: true
    }).populate('clientId', 'clientId');
    
    if (!expert) {
      return res.status(404).json({ success: false, message: 'Expert not found' });
    }
    
    const expertObj = withClientIdString(expert);
    if (expertObj.profilePhotoKey || expertObj.profilePhoto) {
      try {
        const imageKey = expertObj.profilePhotoKey || extractS3KeyFromUrl(expertObj.profilePhoto);
        if (imageKey) {
          expertObj.profilePhoto = await getobject(imageKey, 604800);
        }
      } catch (error) {
        console.error('Error generating profile photo presigned URL:', error);
      }
    }
    if (expertObj.backgroundBannerKey || expertObj.backgroundBanner) {
      try {
        const imageKey = expertObj.backgroundBannerKey || extractS3KeyFromUrl(expertObj.backgroundBanner);
        if (imageKey) {
          expertObj.backgroundBanner = await getobject(imageKey, 604800);
        }
      } catch (error) {
        console.error('Error generating banner presigned URL:', error);
      }
    }
    
    res.json({ success: true, data: expertObj });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// CREATE new expert
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, experience, expertise, profileSummary, chatCharge, voiceCharge, videoCharge, status } = req.body;
    
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client or user role required.'
      });
    }
    
    if (!name || !experience || !expertise || !profileSummary || !chatCharge || !voiceCharge || !videoCharge) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: name, experience, expertise, profileSummary, and pricing are required' 
      });
    }
    
    const newExpert = new Expert({
      name,
      experience,
      expertise,
      profileSummary,
      chatCharge: Number(chatCharge),
      voiceCharge: Number(voiceCharge),
      videoCharge: Number(videoCharge),
      status: status || 'offline',
      clientId: clientId
    });
    
    const savedExpert = await newExpert.save();
    await savedExpert.populate('clientId', 'clientId');
    res.status(201).json({ success: true, data: withClientIdString(savedExpert) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Upload profile photo
router.post('/:id/upload-profile-photo', authenticate, upload.single('profilePhoto'), async (req, res) => {
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

    const expert = await Expert.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false,
      isActive: true
    }).populate('clientId', 'clientId');
    
    if (!expert) {
      return res.status(404).json({
        success: false,
        message: 'Expert not found'
      });
    }

    const uploadResult = await uploadToS3(req.file, 'experts/profile-photos');
    const imageUrl = uploadResult.url;
    const imageKey = uploadResult.key;

    expert.profilePhoto = imageUrl;
    expert.profilePhotoKey = imageKey;
    await expert.save();

    res.json({
      success: true,
      message: 'Profile photo uploaded successfully',
      data: {
        imageUrl: imageUrl,
        clientId: expert.clientId?.clientId || expert.clientId
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile photo',
      error: error.message
    });
  }
});

// Upload background banner
router.post('/:id/upload-banner', authenticate, upload.single('backgroundBanner'), async (req, res) => {
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

    const expert = await Expert.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false,
      isActive: true
    }).populate('clientId', 'clientId');
    
    if (!expert) {
      return res.status(404).json({
        success: false,
        message: 'Expert not found'
      });
    }

    const uploadResult = await uploadToS3(req.file, 'experts/banners');
    const imageUrl = uploadResult.url;
    const imageKey = uploadResult.key;

    expert.backgroundBanner = imageUrl;
    expert.backgroundBannerKey = imageKey;
    await expert.save();

    res.json({
      success: true,
      message: 'Background banner uploaded successfully',
      data: {
        imageUrl: imageUrl,
        clientId: expert.clientId?.clientId || expert.clientId
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to upload background banner',
      error: error.message
    });
  }
});

// UPDATE expert
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, experience, expertise, profileSummary, chatCharge, voiceCharge, videoCharge, status, isActive } = req.body;
    
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client or user role required.'
      });
    }
    
    const expert = await Expert.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false
    });
    
    if (!expert) {
      return res.status(404).json({ success: false, message: 'Expert not found' });
    }
    
    const updateData = {};
    
    if (name !== undefined) updateData.name = name;
    if (experience !== undefined) updateData.experience = experience;
    if (expertise !== undefined) updateData.expertise = expertise;
    if (profileSummary !== undefined) updateData.profileSummary = profileSummary;
    if (chatCharge !== undefined) updateData.chatCharge = Number(chatCharge);
    if (voiceCharge !== undefined) updateData.voiceCharge = Number(voiceCharge);
    if (videoCharge !== undefined) updateData.videoCharge = Number(videoCharge);
    if (status !== undefined && status !== null && status !== '') updateData.status = status;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    
    const updatedExpert = await Expert.findOneAndUpdate(
      {
        _id: req.params.id,
        clientId: clientId,
        isDeleted: false
      },
      updateData,
      { new: true, runValidators: false }
    ).populate('clientId', 'clientId');
    
    if (!updatedExpert) {
      return res.status(404).json({ success: false, message: 'Expert not found' });
    }
    
    res.json({ success: true, data: withClientIdString(updatedExpert) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// DELETE expert (soft delete)
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
    
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client or user role required.'
      });
    }
    
    const expert = await Expert.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false
    });
    
    if (!expert) {
      return res.status(404).json({ success: false, message: 'Expert not found' });
    }
    
    expert.isDeleted = true;
    await expert.save();
    
    res.json({ success: true, message: 'Expert deleted successfully' });
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
    
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Client or user role required.'
      });
    }
    
    const expert = await Expert.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false
    }).populate('clientId', 'clientId');
    
    if (!expert) {
      return res.status(404).json({ success: false, message: 'Expert not found' });
    }
    
    expert.isActive = !expert.isActive;
    const updatedExpert = await expert.save();
    
    res.json({ 
      success: true, 
      data: withClientIdString(updatedExpert),
      message: `Expert ${updatedExpert.isActive ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;