import express from 'express';
import mongoose from 'mongoose';
import Sponsor from '../../models/Sponsor.js';
import Client from '../../models/Client.js';
import { authenticate } from '../../middleware/auth.js';
import { getPresignedUrl } from '../../utils/storage.js';

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
  
  // If clientId is populated with Client document, extract the clientId field
  if (obj.clientId && typeof obj.clientId === 'object' && obj.clientId.clientId) {
    return { ...obj, clientId: obj.clientId.clientId };
  }
  
  // If clientId is just an ObjectId, keep it as is (will be handled by populate)
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

// GET /api/sponsors - Get all sponsors for authenticated client
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
    
    const sponsors = await Sponsor.find(query)
      .populate('clientId', 'clientId')
      .sort({ createdAt: -1 });

    // Generate presigned URLs for logos
    const sponsorsWithUrls = await Promise.all(
      sponsors.map(async (sponsor) => {
        const sponsorObj = withClientIdString(sponsor);
        
        // Generate presigned URL for logo if exists
        if (sponsorObj.logoKey || sponsorObj.logo) {
          try {
            // Use stored key if available, otherwise extract from URL
            const logoKey = sponsorObj.logoKey || extractS3KeyFromUrl(sponsorObj.logo);
            if (logoKey) {
              sponsorObj.logo = await getPresignedUrl(logoKey);
            }
          } catch (error) {
            console.error('Error generating logo presigned URL:', error);
          }
        }
        
        return sponsorObj;
      })
    );

    res.json({
      success: true,
      data: {
        data: sponsorsWithUrls,
        count: sponsorsWithUrls.length
      }
    });
  } catch (error) {
    console.error('Error fetching sponsors:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sponsors',
      error: error.message
    });
  }
});

// GET /api/sponsors/:id - Get single sponsor
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
    
    const sponsor = await Sponsor.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false,
      isActive: true
    }).populate('clientId', 'clientId');

    if (!sponsor) {
      return res.status(404).json({
        success: false,
        message: 'Sponsor not found'
      });
    }

    const obj = sponsor.toObject();
    if (obj.clientId && typeof obj.clientId === 'object') {
      obj.clientId = obj.clientId.clientId; // Extract CLI-ABC123
    }

    // Generate presigned URL for logo if exists
    if (obj.logoKey || obj.logo) {
      try {
        // Use stored key if available, otherwise extract from URL
        const logoKey = obj.logoKey || extractS3KeyFromUrl(obj.logo);
        if (logoKey) {
          obj.logo = await getPresignedUrl(logoKey);
        }
      } catch (error) {
        console.error('Error generating logo presigned URL:', error);
      }
    }

    res.json({
      success: true,
      data: obj
    });
  } catch (error) {
    console.error('Error fetching sponsor:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sponsor',
      error: error.message
    });
  }
});

// POST /api/sponsors - Create new sponsor
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description, website, sponsorshipType } = req.body;
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Sponsor name is required'
      });
    }

    if (sponsorshipType && !['Platinum', 'Gold', 'Silver', 'Bronze'].includes(sponsorshipType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sponsorship type'
      });
    }

    const sponsor = new Sponsor({
      name: name.trim(),
      description: description ? description.trim() : '',
      website: website ? website.trim() : '',
      sponsorshipType: sponsorshipType || 'Gold',
      clientId: clientId
    });

    await sponsor.save();

    const populated = await sponsor.populate('clientId', 'clientId');
    const obj = populated.toObject();
    if (obj.clientId && typeof obj.clientId === 'object') {
      obj.clientId = obj.clientId.clientId; // Extract CLI-ABC123
    }

    res.status(201).json({
      success: true,
      message: 'Sponsor created successfully',
      data: obj
    });
  } catch (error) {
    console.error('Error creating sponsor:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create sponsor',
      error: error.message
    });
  }
});

// PUT /api/sponsors/:id - Update sponsor
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, description, website, sponsorshipType } = req.body;
    let clientId;
    try {
      clientId = await getClientId(req);
    } catch (clientIdError) {
      return res.status(401).json({
        success: false,
        message: clientIdError.message || 'Unable to determine client ID. Please ensure your token is valid.'
      });
    }

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Sponsor name is required'
      });
    }

    if (sponsorshipType && !['Platinum', 'Gold', 'Silver', 'Bronze'].includes(sponsorshipType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sponsorship type'
      });
    }

    const sponsor = await Sponsor.findOneAndUpdate(
      {
        _id: req.params.id,
        clientId: clientId,
        isDeleted: false,
        isActive: true
      },
      {
        name: name.trim(),
        description: description ? description.trim() : '',
        website: website ? website.trim() : '',
        sponsorshipType: sponsorshipType || 'Gold'
      },
      { new: true, runValidators: true }
    ).populate('clientId', 'clientId');

    if (!sponsor) {
      return res.status(404).json({
        success: false,
        message: 'Sponsor not found'
      });
    }

    const obj = sponsor.toObject();
    if (obj.clientId && typeof obj.clientId === 'object') {
      obj.clientId = obj.clientId.clientId; // Extract CLI-ABC123
    }

    res.json({
      success: true,
      message: 'Sponsor updated successfully',
      data: obj
    });
  } catch (error) {
    console.error('Error updating sponsor:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update sponsor',
      error: error.message
    });
  }
});

// DELETE /api/sponsors/:id - Delete sponsor (soft delete)
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
    
    const sponsor = await Sponsor.findOneAndUpdate(
      {
        _id: req.params.id,
        clientId: clientId,
        isDeleted: false
      },
      { isDeleted: true },
      { new: true }
    );

    if (!sponsor) {
      return res.status(404).json({
        success: false,
        message: 'Sponsor not found'
      });
    }

    res.json({
      success: true,
      message: 'Sponsor deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting sponsor:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete sponsor',
      error: error.message
    });
  }
});

// PATCH /api/sponsors/:id/toggle - Toggle sponsor status
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
    
    const sponsor = await Sponsor.findOne({
      _id: req.params.id,
      clientId: clientId,
      isDeleted: false
    });

    if (!sponsor) {
      return res.status(404).json({
        success: false,
        message: 'Sponsor not found'
      });
    }

    sponsor.isActive = !sponsor.isActive;
    await sponsor.save();

    const obj = sponsor.toObject();
    if (obj.clientId && typeof obj.clientId === 'object') {
      obj.clientId = obj.clientId.clientId; // Extract CLI-ABC123
    }

    res.json({
      success: true,
      data: obj,
      message: `Sponsor ${sponsor.isActive ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Toggle sponsor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle sponsor status',
      error: error.message
    });
  }
});

export default router;