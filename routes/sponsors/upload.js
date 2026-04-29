import express from 'express';
import Sponsor from '../../models/Sponsor.js';
import { authenticate } from '../../middleware/auth.js';
import multer from 'multer';
import { uploadFile, deleteFile } from '../../utils/storage.js';

const router = express.Router();

// Helper function to extract clientId from request (supports both client and user tokens)
const getClientId = (req) => {
  // If user role, get clientId from decoded token first (most reliable), then populated user object
  if (req.user.role === 'user') {
    // Priority: decodedClientId (from token) > populated clientId._id > clientId ObjectId
    const clientId = req.decodedClientId || req.user.clientId?._id || req.user.clientId || req.user.tokenClientId;
    if (!clientId) {
      throw new Error('Client ID not found for user token. Please ensure your token includes clientId.');
    }
    return clientId;
  }
  // For client role, use user._id (which is the client's MongoDB _id)
  return req.user._id || req.user.id;
};

// Configure multer for logo upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// POST /api/sponsors/:id/upload-logo - Upload logo for sponsor
router.post('/:id/upload-logo', authenticate, upload.single('logo'), async (req, res) => {
  console.log('[Upload Route] Logo upload request received:', {
    sponsorId: req.params.id,
    hasFile: !!req.file,
    fileName: req.file?.originalname,
    fileSize: req.file?.size,
    userRole: req.user?.role,
    userId: req.user?._id
  });
  
  try {
    let clientId;
    try {
      clientId = getClientId(req);
      console.log('[Upload Route] ClientId extracted:', clientId);
    } catch (clientIdError) {
      console.error('[Upload Route] ClientId extraction failed:', clientIdError.message);
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No logo file provided'
      });
    }

    const sponsor = await Sponsor.findOne({
      _id: req.params.id,
      clientId: clientId,
      isActive: true
    });

    if (!sponsor) {
      return res.status(404).json({
        success: false,
        message: 'Sponsor not found'
      });
    }

    // Upload new logo to S3
    const uploadResult = await uploadFile(req.file, 'sponsors');
    const logoUrl = uploadResult.url;
    const logoKey = uploadResult.key;

    // Update sponsor with new logo URL and key
    sponsor.logo = logoUrl;
    sponsor.logoKey = logoKey;
    await sponsor.save();

    res.json({
      success: true,
      message: 'Logo uploaded successfully',
      data: {
        logoUrl: logoUrl
      }
    });
  } catch (error) {
    console.error('Error uploading logo:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload logo',
      error: error.message
    });
  }
});

export default router;