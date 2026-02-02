import express from 'express';
import Chapter from '../models/Chapter.js';
import { authenticate } from '../middleware/auth.js';
import multer from 'multer';
import { uploadToS3 } from '../utils/s3.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// GET all chapters
router.get('/', authenticate, async (req, res) => {
  try {
    const { includeInactive } = req.query;
    const filter = { clientId: req.user._id };
    
    if (!includeInactive || includeInactive !== 'true') {
      filter.status = 'active';
    }
    
    const chapters = await Chapter.find(filter).sort({ chapterNumber: 1 });
    
    // Generate presigned URLs for images
    const chaptersWithSignedUrls = await Promise.all(
      chapters.map(async (chapter) => {
        const chapterObj = chapter.toObject();
        if (chapterObj.imageUrl) {
          try {
            const { getobject } = await import('../utils/s3.js');
            chapterObj.imageUrl = await getobject(chapterObj.imageUrl);
          } catch (error) {
            console.error('Error generating presigned URL:', error);
          }
        }
        return chapterObj;
      })
    );
    
    res.json({
      success: true,
      data: chaptersWithSignedUrls,
      total: chaptersWithSignedUrls.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chapters',
      error: error.message
    });
  }
});

// POST create chapter
router.post('/', authenticate, upload.single('image'), async (req, res) => {
  try {
    const { name, chapterNumber, description, shlokaCount, status } = req.body;
    
    // Check if chapter number already exists
    const existingChapter = await Chapter.findOne({ 
      chapterNumber: parseInt(chapterNumber),
      clientId: req.user._id 
    });
    
    if (existingChapter) {
      return res.status(400).json({
        success: false,
        message: `Chapter ${chapterNumber} already exists`
      });
    }
    
    let imageUrl = null;
    if (req.file) {
      const uploadResult = await uploadToS3(req.file, 'chapters');
      imageUrl = uploadResult.url;
    }
    
    const chapter = new Chapter({
      name,
      chapterNumber: parseInt(chapterNumber),
      description,
      shlokaCount: parseInt(shlokaCount),
      imageUrl,
      status,
      clientId: req.user._id
    });
    
    await chapter.save();
    
    // Generate presigned URL for response
    const responseChapter = chapter.toObject();
    if (responseChapter.imageUrl) {
      try {
        const { getobject } = await import('../utils/s3.js');
        responseChapter.imageUrl = await getobject(responseChapter.imageUrl);
      } catch (error) {
        console.error('Error generating presigned URL for response:', error);
      }
    }
    
    res.status(201).json({
      success: true,
      message: 'Chapter created successfully',
      data: responseChapter
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create chapter',
      error: error.message
    });
  }
});

// DELETE chapter
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const chapter = await Chapter.findOneAndDelete({ 
      _id: req.params.id, 
      clientId: req.user._id 
    });
    
    if (!chapter) {
      return res.status(404).json({
        success: false,
        message: 'Chapter not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Chapter deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete chapter',
      error: error.message
    });
  }
});

// PUT update chapter
router.put('/:id', authenticate, upload.single('image'), async (req, res) => {
  try {
    const { name, chapterNumber, description, shlokaCount, status } = req.body;
    
    const updateData = {
      name,
      chapterNumber: parseInt(chapterNumber),
      description,
      shlokaCount: parseInt(shlokaCount),
      status
    };
    
    // Handle image upload if provided
    if (req.file) {
      const uploadResult = await uploadToS3(req.file, 'chapters');
      updateData.imageUrl = uploadResult.url;
    }
    // Don't update imageUrl if no new image is provided - keep existing one
    
    const chapter = await Chapter.findOneAndUpdate(
      { _id: req.params.id, clientId: req.user._id },
      updateData,
      { new: true }
    );
    
    if (!chapter) {
      return res.status(404).json({
        success: false,
        message: 'Chapter not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Chapter updated successfully',
      data: chapter
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update chapter',
      error: error.message
    });
  }
});

// PATCH toggle chapter status
router.patch('/:id/toggle-status', authenticate, async (req, res) => {
  try {
    const chapter = await Chapter.findOne({ 
      _id: req.params.id, 
      clientId: req.user._id 
    });
    
    if (!chapter) {
      return res.status(404).json({
        success: false,
        message: 'Chapter not found'
      });
    }
    
    chapter.status = chapter.status === 'active' ? 'inactive' : 'active';
    await chapter.save();
    
    res.json({
      success: true,
      message: `Chapter ${chapter.status === 'active' ? 'enabled' : 'disabled'} successfully`,
      data: chapter
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to toggle chapter status',
      error: error.message
    });
  }
});

// POST upload chapter image
router.post('/:id/upload-image', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }
    
    const uploadResult = await uploadToS3(req.file, 'chapters');
    
    const chapter = await Chapter.findOneAndUpdate(
      { _id: req.params.id, clientId: req.user._id },
      { imageUrl: uploadResult.url },
      { new: true }
    );
    
    if (!chapter) {
      return res.status(404).json({
        success: false,
        message: 'Chapter not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: chapter,
      imageUrl: uploadResult.url
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
});

export default router;