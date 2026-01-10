import express from 'express';
import multer from 'multer';
import User from '../../models/User.js';
import { getobject, s3Client } from '../../utils/s3.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Configure multer for memory storage (to handle file uploads)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

/**
 * POST /api/mobile/user/register-with-image
 * Register user with profile image upload
 * Accepts multipart/form-data with image file
 */
router.post('/register-with-image', upload.single('image'), async (req, res) => {
  try {
    const { email, password, name, dob, timeOfBirth, placeOfBirth, gowthra, profession } = req.body;
    const imageFile = req.file;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    let profileImageKey = null;

    // Upload image to S3 if provided
    if (imageFile) {
      try {
        // Generate unique key for the image
        const fileExtension = imageFile.originalname.split('.').pop() || 'jpg';
        const imageKey = `user-profiles/${uuidv4()}.${fileExtension}`;

        // Upload to S3 directly using the existing s3Client
        const uploadCommand = new PutObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: imageKey,
          Body: imageFile.buffer,
          ContentType: imageFile.mimetype,
        });

        await s3Client.send(uploadCommand);
        profileImageKey = imageKey;
      } catch (s3Error) {
        console.error('Error uploading image to S3:', s3Error);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload image. Please try again.'
        });
      }
    }

    // Create user with profile data
    const user = new User({
      email: email.toLowerCase().trim(),
      password,
      profileImage: profileImageKey,
      profile: {
        name: name || '',
        dob: dob ? new Date(dob) : undefined,
        timeOfBirth: timeOfBirth || '',
        placeOfBirth: placeOfBirth || '',
        gowthra: gowthra || '',
        profession: profession || undefined,
      },
      loginApproved: false, // Requires super admin approval
    });

    await user.save();

    // Get presigned URL for the image if uploaded
    let profileImageUrl = null;
    if (profileImageKey) {
      try {
        profileImageUrl = await getobject(profileImageKey);
      } catch (error) {
        console.error('Error generating presigned URL for profile image:', error);
        // Continue without image URL
      }
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please wait for super admin approval to login.',
      data: {
        user: {
          ...user.toObject(),
          profileImageUrl: profileImageUrl,
        }
      }
    });
  } catch (error) {
    console.error('Error in register-with-image:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Registration failed. Please try again.'
    });
  }
});

export default router;

