import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import SpiritualConfiguration from '../models/SpiritualConfiguration.js';

const router = express.Router();

// Helper function to get default categoryId based on type
const getDefaultCategoryId = (type) => {
  const typeToCategory = {
    'meditation': '69787dfbbeaf7e42675a221d',
    'chanting': '69787dcbbeaf7e42675a2212',
    'silence': '69787d8bbeaf7e42675a2207',
    'prayer': '69787d32beaf7e42675a21f8'
  };
  return typeToCategory[type] || '';
};

// All routes require authentication
router.use(authenticateToken);

// Create new spiritual configuration
const createConfiguration = async (req, res) => {
  try {
    const { title, duration, description, emotion, type, karmaPoints, chantingType, customChantingType, categoryId } = req.body;
    
    // Get clientId based on user role
    let clientId;
    if (req.user.role === 'client') {
      clientId = req.user.clientId; // Already in CLI-XXXXXX format
    } else if (req.user.role === 'user') {
      // For regular users, get clientId from their profile
      clientId = req.user.clientId?.clientId || req.user.tokenClientId;
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only clients and users can create configurations.'
      });
    }

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'Client ID not found. Please contact support.'
      });
    }

    const configuration = new SpiritualConfiguration({
      title,
      duration: duration || '15 minutes',
      description,
      emotion,
      type,
      karmaPoints: karmaPoints || 10,
      chantingType: chantingType || '',
      customChantingType: customChantingType || '',
      categoryId: categoryId || getDefaultCategoryId(type),
      clientId
    });

    await configuration.save();

    res.status(201).json({
      success: true,
      message: 'Spiritual configuration created successfully',
      data: configuration
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Get all configurations for a client
const getConfigurations = async (req, res) => {
  try {
    // Get clientId based on user role
    let clientId;
    if (req.user.role === 'client') {
      clientId = req.user.clientId;
    } else if (req.user.role === 'user') {
      clientId = req.user.clientId?.clientId || req.user.tokenClientId;
    }
    
    // Build query with optional filters
    const query = {
      isDeleted: false
    };
    
    // Add clientId filter if available
    if (clientId) {
      query.clientId = clientId;
    }
    
    // Handle categoryId to type mapping for backward compatibility
    if (req.query.categoryId) {
      // Map categoryId to type for existing configurations
      const categoryToTypeMap = {
        '69787dfbbeaf7e42675a221d': 'meditation',
        '69787dcbbeaf7e42675a2212': 'chanting', 
        '69787d8bbeaf7e42675a2207': 'silence',
        '69787d32beaf7e42675a21f8': 'prayer'
      };
      
      const mappedType = categoryToTypeMap[req.query.categoryId];
      if (mappedType) {
        // Get all configurations of the mapped type (both with and without categoryId)
        query.type = mappedType;
      } else {
        query.categoryId = req.query.categoryId;
      }
    }
    
    if (req.query.type) {
      query.type = req.query.type;
    }
    
    const configurations = await SpiritualConfiguration.find(query).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: configurations,
      count: configurations.length
    });
  } catch (error) {
    console.error('[Spiritual Config] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Update configuration
const updateConfiguration = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, duration, description, emotion, karmaPoints, chantingType, customChantingType, categoryId } = req.body;
    
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only clients and users can update configurations.'
      });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (duration !== undefined) updateData.duration = duration;
    if (description !== undefined) updateData.description = description;
    if (emotion !== undefined) updateData.emotion = emotion;
    if (karmaPoints !== undefined) updateData.karmaPoints = karmaPoints;
    if (chantingType !== undefined) updateData.chantingType = chantingType;
    if (customChantingType !== undefined) updateData.customChantingType = customChantingType;
    if (categoryId !== undefined) updateData.categoryId = categoryId;

    const configuration = await SpiritualConfiguration.findOneAndUpdate(
      { _id: id, isDeleted: false },
      updateData,
      { new: true, runValidators: true }
    );

    if (!configuration) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Configuration updated successfully',
      data: configuration
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Delete configuration (soft delete)
const deleteConfiguration = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only clients and users can delete configurations.'
      });
    }

    const configuration = await SpiritualConfiguration.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { isDeleted: true },
      { new: true }
    );

    if (!configuration) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Configuration deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Toggle configuration status
const toggleConfiguration = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!['client', 'user'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only clients and users can toggle configurations.'
      });
    }

    const configuration = await SpiritualConfiguration.findOne({
      _id: id, 
      isDeleted: false
    });

    if (!configuration) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }

    configuration.isActive = !configuration.isActive;
    await configuration.save();

    res.status(200).json({
      success: true,
      message: `Configuration ${configuration.isActive ? 'enabled' : 'disabled'} successfully`,
      data: {
        isActive: configuration.isActive
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get single configuration by ID
const getSingleConfiguration = async (req, res) => {
  try {
    const { id } = req.params;
    
    const configuration = await SpiritualConfiguration.findOne({
      _id: id,
      isDeleted: false
    });

    if (!configuration) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }

    res.status(200).json({
      success: true,
      data: configuration
    });
  } catch (error) {
    console.error('[Spiritual Config] Get single error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Routes
router.post('/', createConfiguration);
router.get('/', getConfigurations);
router.get('/:id', getSingleConfiguration);
router.put('/:id', updateConfiguration);
router.delete('/:id', deleteConfiguration);
router.patch('/:id/toggle', toggleConfiguration);

export default router;