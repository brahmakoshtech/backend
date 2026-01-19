import ExpertCategory from '../../models/ExpertCategory.js';
import { getClientIdFromToken } from '../../utils/auth.js';
import { getobject, extractS3KeyFromUrl } from '../../utils/s3.js';

// Create Expert Category
export const createExpertCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const clientId = getClientIdFromToken(req);

    if (!clientId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    // Check if category with same name exists for this client
    const existingCategory = await ExpertCategory.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      clientId,
      isDeleted: false
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        error: 'Category with this name already exists'
      });
    }

    const expertCategory = new ExpertCategory({
      name,
      description,
      clientId
    });

    await expertCategory.save();

    res.status(201).json({
      success: true,
      data: expertCategory
    });
  } catch (error) {
    console.error('Create expert category error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create expert category'
    });
  }
};

// Get All Expert Categories
export const getAllExpertCategories = async (req, res) => {
  try {
    const clientId = getClientIdFromToken(req);

    if (!clientId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    const categories = await ExpertCategory.find({
      clientId,
      isDeleted: false
    }).sort({ createdAt: -1 });

    // Generate presigned URLs for images
    const categoriesWithPresignedUrls = await Promise.all(
      categories.map(async (category) => {
        const categoryObj = category.toObject();
        
        // Generate presigned URL for image
        if (categoryObj.imageKey || categoryObj.image) {
          try {
            const imageKey = categoryObj.imageKey || extractS3KeyFromUrl(categoryObj.image);
            if (imageKey) {
              categoryObj.image = await getobject(imageKey, 604800);
            }
          } catch (error) {
            console.error('Error generating image presigned URL:', error);
          }
        }
        
        return categoryObj;
      })
    );

    res.json({
      success: true,
      data: {
        success: true,
        data: categoriesWithPresignedUrls,
        count: categoriesWithPresignedUrls.length
      }
    });
  } catch (error) {
    console.error('Get expert categories error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch expert categories'
    });
  }
};

// Get Expert Category by ID
export const getExpertCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = getClientIdFromToken(req);

    if (!clientId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    const category = await ExpertCategory.findOne({
      _id: id,
      clientId,
      isDeleted: false
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Expert category not found'
      });
    }

    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    console.error('Get expert category error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch expert category'
    });
  }
};

// Update Expert Category
export const updateExpertCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const clientId = getClientIdFromToken(req);

    if (!clientId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    // Check if category exists
    const category = await ExpertCategory.findOne({
      _id: id,
      clientId,
      isDeleted: false
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Expert category not found'
      });
    }

    // Check if name is being changed and if new name already exists
    if (name && name !== category.name) {
      const existingCategory = await ExpertCategory.findOne({
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        clientId,
        isDeleted: false,
        _id: { $ne: id }
      });

      if (existingCategory) {
        return res.status(400).json({
          success: false,
          error: 'Category with this name already exists'
        });
      }
    }

    // Update fields
    if (name) category.name = name;
    if (description) category.description = description;

    await category.save();

    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    console.error('Update expert category error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update expert category'
    });
  }
};

// Delete Expert Category
export const deleteExpertCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = getClientIdFromToken(req);

    if (!clientId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    const category = await ExpertCategory.findOne({
      _id: id,
      clientId,
      isDeleted: false
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Expert category not found'
      });
    }

    // Soft delete
    category.isDeleted = true;
    await category.save();

    res.json({
      success: true,
      message: 'Expert category deleted successfully'
    });
  } catch (error) {
    console.error('Delete expert category error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete expert category'
    });
  }
};

// Toggle Expert Category Status
export const toggleExpertCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = getClientIdFromToken(req);

    if (!clientId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    const category = await ExpertCategory.findOne({
      _id: id,
      clientId,
      isDeleted: false
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Expert category not found'
      });
    }

    category.isActive = !category.isActive;
    await category.save();

    res.json({
      success: true,
      data: {
        isActive: category.isActive
      }
    });
  } catch (error) {
    console.error('Toggle expert category status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle expert category status'
    });
  }
};