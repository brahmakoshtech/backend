import express from 'express';
import BrandAsset from '../../models/BrandAsset.js';
import multer from 'multer';
import { uploadToS3, deleteFromS3 } from '../../utils/s3.js';
import { authenticateTestimonial } from '../../middleware/testimonialAuth.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

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

router.get('/', authenticateTestimonial, async (req, res) => {
  try {
    const clientId = req.user._id || req.user.id;
    const brandAssets = await BrandAsset.find({ 
      clientId: clientId,
      isActive: true 
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: brandAssets,
      count: brandAssets.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brand assets',
      error: error.message
    });
  }
});

router.post('/', authenticateTestimonial, async (req, res) => {
  try {
    const { headingText, brandLogoName, webLinkUrl, socialLink } = req.body;
    const clientId = req.user._id || req.user.id;

    if (!headingText || !brandLogoName || !webLinkUrl || !socialLink) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    const newBrandAsset = new BrandAsset({
      headingText: headingText.trim(),
      brandLogoName: brandLogoName.trim(),
      webLinkUrl: webLinkUrl.trim(),
      socialLink: socialLink.trim(),
      clientId
    });

    const savedBrandAsset = await newBrandAsset.save();

    res.status(201).json({
      success: true,
      message: 'Brand asset created successfully',
      data: savedBrandAsset
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to create brand asset',
      error: error.message
    });
  }
});

router.put('/:id', authenticateTestimonial, async (req, res) => {
  try {
    const { headingText, brandLogoName, webLinkUrl, socialLink } = req.body;
    const clientId = req.user._id || req.user.id;

    const brandAsset = await BrandAsset.findOneAndUpdate(
      { _id: req.params.id, clientId: clientId, isActive: true },
      { headingText, brandLogoName, webLinkUrl, socialLink },
      { new: true, runValidators: true }
    );

    if (!brandAsset) {
      return res.status(404).json({
        success: false,
        message: 'Brand asset not found'
      });
    }

    res.json({
      success: true,
      message: 'Brand asset updated successfully',
      data: brandAsset
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to update brand asset',
      error: error.message
    });
  }
});

router.delete('/:id', authenticateTestimonial, async (req, res) => {
  try {
    const clientId = req.user._id || req.user.id;
    const brandAsset = await BrandAsset.findOne({
      _id: req.params.id,
      clientId: clientId,
      isActive: true
    });

    if (!brandAsset) {
      return res.status(404).json({
        success: false,
        message: 'Brand asset not found'
      });
    }

    brandAsset.isActive = false;
    await brandAsset.save();

    res.json({
      success: true,
      message: 'Brand asset deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete brand asset',
      error: error.message
    });
  }
});

export default router;