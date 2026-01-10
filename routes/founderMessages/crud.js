import express from 'express';
import FounderMessage from '../../models/FounderMessage.js';
import multer from 'multer';
import { uploadToS3, deleteFromS3 } from '../../utils/s3.js';

console.log('FounderMessage CRUD routes loaded');

const router = express.Router();

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
router.get('/', async (req, res) => {
  try {
    const messages = await FounderMessage.find().sort({ createdAt: -1 });
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single founder message
router.get('/:id', async (req, res) => {
  try {
    const message = await FounderMessage.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    res.json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// CREATE new founder message (without image)
router.post('/', async (req, res) => {
  try {
    const { founderName, position, content, status } = req.body;
    
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
      status: status || 'draft'
    });
    
    const savedMessage = await newMessage.save();
    res.status(201).json({ success: true, data: savedMessage });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Upload image for founder message
router.post('/:id/upload-image', upload.single('founderImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const message = await FounderMessage.findById(req.params.id);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Upload image to S3
    const imageUrl = await uploadToS3(req.file, 'founder-messages');

    // Update message with image URL
    message.founderImage = imageUrl;
    await message.save();

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        imageUrl: imageUrl
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
router.put('/:id', upload.single('founderImage'), async (req, res) => {
  try {
    const { founderName, position, content, status } = req.body;
    const message = await FounderMessage.findById(req.params.id);
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    let founderImageUrl = message.founderImage;
    
    // Upload new image if provided (exactly like testimonials)
    if (req.file) {
      // Delete old image from S3 if exists
      if (message.founderImage) {
        try {
          await deleteFromS3(message.founderImage);
        } catch (deleteError) {
          console.warn('Failed to delete old image:', deleteError);
        }
      }
      
      founderImageUrl = await uploadToS3(req.file, 'founder-messages');
    }
    
    const updatedMessage = await FounderMessage.findByIdAndUpdate(
      req.params.id,
      {
        founderName,
        position,
        content,
        founderImage: founderImageUrl,
        status
      },
      { new: true }
    );
    
    res.json({ success: true, data: updatedMessage });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// DELETE founder message
router.delete('/:id', async (req, res) => {
  try {
    const message = await FounderMessage.findById(req.params.id);
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    // Delete image from S3 if exists
    if (message.founderImage) {
      try {
        await deleteFromS3(message.founderImage);
      } catch (deleteError) {
        console.warn('Failed to delete image:', deleteError);
      }
    }
    
    await FounderMessage.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Message deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// TOGGLE status (publish/unpublish)
router.patch('/:id/toggle', async (req, res) => {
  try {
    const message = await FounderMessage.findById(req.params.id);
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    
    message.status = message.status === 'published' ? 'draft' : 'published';
    const updatedMessage = await message.save();
    
    res.json({ success: true, data: updatedMessage });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// INCREMENT views
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