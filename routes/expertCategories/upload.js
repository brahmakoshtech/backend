import multer from 'multer';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import ExpertCategory from '../../models/ExpertCategory.js';
import { getClientIdFromToken } from '../../utils/auth.js';

// Configure S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
});

// Upload Category Image
export const uploadCategoryImage = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const clientId = getClientIdFromToken(req);

    if (!clientId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }

    // Find the category
    const category = await ExpertCategory.findOne({
      _id: categoryId,
      clientId,
      isDeleted: false
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Expert category not found'
      });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `expert-categories/${timestamp}-${req.file.originalname}`;

    // Upload to S3
    const uploadParams = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: filename,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // Delete old image if exists
    if (category.imageKey) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: category.imageKey,
        }));
      } catch (deleteError) {
        console.error('Error deleting old image:', deleteError);
      }
    }

    // Generate S3 URL
    const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;

    // Update category with new image
    category.image = imageUrl; // Store full URL
    category.imageKey = filename;
    await category.save();

    res.json({
      success: true,
      data: {
        imageUrl: imageUrl // Return full URL
      }
    });
  } catch (error) {
    console.error('Upload category image error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload image'
    });
  }
};