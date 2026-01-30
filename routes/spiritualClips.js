import express from 'express';
import SpiritualClip from '../models/SpiritualClip.js';
import { authenticate } from '../middleware/auth.js';
import multer from 'multer';
import { uploadToS3, deleteFromS3 } from '../utils/s3.js';

const router = express.Router();

// Configure multer for memory storage (S3 upload)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video and audio files are allowed!'), false);
    }
  }
});

import mongoose from 'mongoose';

// Helper function to extract clientId
const getClientId = (req) => {
  console.log('User object:', req.user);
  
  if (req.user.role === 'client') {
    return req.user.clientId; // This is string format like CLI-BSJFUI
  } else if (req.user.role === 'user') {
    // For users, extract the clientId from nested structure
    return req.user.clientId?.clientId || req.user.tokenClientId;
  }
  
  return null;
};

// GET /api/spiritual-clips/configuration/:configId - Get all clips for a specific configuration
router.get('/configuration/:configId', authenticate, async (req, res) => {
  try {
    const { configId } = req.params;
    console.log('Fetching clips for configuration:', configId);

    // Validate configId format
    if (!mongoose.Types.ObjectId.isValid(configId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid configuration ID format'
      });
    }

    // Find clips with the specific suitableConfiguration
    const clips = await SpiritualClip.find({ 
      suitableConfiguration: configId,
      isActive: true 
    })
    .populate('suitableConfiguration', 'title description type duration karmaPoints')
    .sort({ createdAt: -1 });

    // Convert S3 URLs to presigned URLs for access
    const { getobject } = await import('../utils/s3.js');
    
    const clipsWithSignedUrls = await Promise.all(clips.map(async (clip) => {
      const clipObj = clip.toObject();
      
      try {
        // Generate presigned URLs for video and audio
        if (clipObj.videoKey) {
          clipObj.videoUrl = await getobject(clipObj.videoKey, 3600); // 1 hour expiry
        }
        if (clipObj.audioKey) {
          clipObj.audioUrl = await getobject(clipObj.audioKey, 3600); // 1 hour expiry
        }
      } catch (error) {
        console.error('Error generating presigned URLs for clip:', clipObj._id, error);
        // Keep original URLs if presigned URL generation fails
      }
      
      return clipObj;
    }));

    console.log(`Found ${clips.length} clips for configuration ${configId}`);

    res.json({
      success: true,
      data: clipsWithSignedUrls,
      count: clips.length,
      configurationId: configId
    });

  } catch (error) {
    console.error('Get clips by configuration error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clips for configuration',
      error: error.message
    });
  }
});

// GET /api/spiritual-clips - Get all clips for client
router.get('/', authenticate, async (req, res) => {
  try {
    console.log('Fetching all clips');

    // Build query with optional type filter - no client filtering
    const query = {};
    if (req.query.type) {
      query.type = req.query.type;
    }

    const clips = await SpiritualClip.find(query)
      .populate('suitableConfiguration', 'title description')
      .sort({ createdAt: -1 });

    // Convert S3 URLs to presigned URLs for access
    const { getobject } = await import('../utils/s3.js');
    
    const clipsWithSignedUrls = await Promise.all(clips.map(async (clip) => {
      const clipObj = clip.toObject();
      
      // Ensure suitableConfiguration is always present in response
      if (!clipObj.suitableConfiguration) {
        clipObj.suitableConfiguration = null;
      }
      
      try {
        // Generate presigned URLs for video and audio
        if (clipObj.videoKey) {
          clipObj.videoUrl = await getobject(clipObj.videoKey, 3600); // 1 hour expiry
        }
        if (clipObj.audioKey) {
          clipObj.audioUrl = await getobject(clipObj.audioKey, 3600); // 1 hour expiry
        }
      } catch (error) {
        console.error('Error generating presigned URLs for clip:', clipObj._id, error);
        // Keep original URLs if presigned URL generation fails
      }
      
      return clipObj;
    }));

    console.log(`Found ${clips.length} clips`);

    res.json({
      success: true,
      data: clipsWithSignedUrls,
      count: clips.length
    });

  } catch (error) {
    console.error('Get clips error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clips',
      error: error.message
    });
  }
});

// POST /api/spiritual-clips/upload-url - Generate presigned URL for direct S3 upload
router.post('/upload-url', authenticate, async (req, res) => {
  try {
    const { fileName, contentType, fileType } = req.body;
    
    if (!fileName || !contentType) {
      return res.status(400).json({
        success: false,
        message: 'fileName and contentType are required'
      });
    }
    
    const folder = fileType === 'video' ? 'spiritual-clips/videos' : 'spiritual-clips/audios';
    const { generateUploadUrl } = await import('../utils/s3.js');
    const { uploadUrl, fileUrl, key } = await generateUploadUrl(fileName, contentType, folder);
    
    res.json({
      success: true,
      data: { uploadUrl, fileUrl, key }
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL',
      error: error.message
    });
  }
});

// POST /api/spiritual-clips/direct - Create clip with direct S3 URLs
router.post('/direct', authenticate, async (req, res) => {
  try {
    const clientId = getClientId(req);
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'Client ID not found'
      });
    }

    const { title, description, suitableTime, guided, transcript, type, videoUrl, audioUrl, suitableConfiguration } = req.body;

    // Validation
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    const { extractS3KeyFromUrl } = await import('../utils/s3.js');
    
    const clipData = {
      clientId,
      title: title.trim(),
      description: description.trim(),
      suitableTime: suitableTime || '',
      guided: guided || '',
      transcript: transcript || '',
      type: type || 'meditation',  // Default to meditation if not provided
      suitableConfiguration: suitableConfiguration || null,
      videoUrl: videoUrl || undefined,
      videoKey: videoUrl ? extractS3KeyFromUrl(videoUrl) : undefined,
      audioUrl: audioUrl || undefined,
      audioKey: audioUrl ? extractS3KeyFromUrl(audioUrl) : undefined
    };

    const clip = new SpiritualClip(clipData);
    await clip.save();

    // Generate presigned URLs for response
    const { getobject } = await import('../utils/s3.js');
    const clipObj = clip.toObject();
    
    if (clipObj.videoKey) {
      try {
        clipObj.videoUrl = await getobject(clipObj.videoKey, 3600);
      } catch (error) {
        console.error('Error generating video presigned URL:', error);
      }
    }
    
    if (clipObj.audioKey) {
      try {
        clipObj.audioUrl = await getobject(clipObj.audioKey, 3600);
      } catch (error) {
        console.error('Error generating audio presigned URL:', error);
      }
    }

    res.status(201).json({
      success: true,
      data: clipObj,
      message: 'Clip created successfully'
    });

  } catch (error) {
    console.error('Create clip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create clip',
      error: error.message
    });
  }
});
// PUT /api/spiritual-clips/:id/direct - Update clip with direct S3 URLs
router.put('/:id/direct', authenticate, async (req, res) => {
  try {
    const { title, description, suitableTime, guided, transcript, suitableConfiguration, videoUrl, audioUrl } = req.body;

    const updateData = {
      title: title?.trim(),
      description: description?.trim(),
      suitableTime: suitableTime || '',
      guided: guided || '',
      transcript: transcript || '',
      suitableConfiguration: suitableConfiguration || null
    };

    // Add video URL and key if provided
    if (videoUrl) {
      const { extractS3KeyFromUrl } = await import('../utils/s3.js');
      updateData.videoUrl = videoUrl;
      updateData.videoKey = extractS3KeyFromUrl(videoUrl);
    }

    // Add audio URL and key if provided
    if (audioUrl) {
      const { extractS3KeyFromUrl } = await import('../utils/s3.js');
      updateData.audioUrl = audioUrl;
      updateData.audioKey = extractS3KeyFromUrl(audioUrl);
    }

    const clip = await SpiritualClip.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('suitableConfiguration', 'title description');

    if (!clip) {
      return res.status(404).json({
        success: false,
        message: 'Clip not found'
      });
    }

    // Generate presigned URLs for response
    const { getobject } = await import('../utils/s3.js');
    const clipObj = clip.toObject();
    
    if (clipObj.videoKey) {
      try {
        clipObj.videoUrl = await getobject(clipObj.videoKey, 3600);
      } catch (error) {
        console.error('Error generating video presigned URL:', error);
      }
    }
    
    if (clipObj.audioKey) {
      try {
        clipObj.audioUrl = await getobject(clipObj.audioKey, 3600);
      } catch (error) {
        console.error('Error generating audio presigned URL:', error);
      }
    }

    res.json({
      success: true,
      data: clipObj,
      message: 'Clip updated successfully'
    });

  } catch (error) {
    console.error('Update clip direct error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update clip',
      error: error.message
    });
  }
});

router.post('/', authenticate, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), async (req, res) => {
  try {
    const clientId = getClientId(req);
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: 'Client ID not found'
      });
    }

    const { title, description, suitableTime, guided, transcript, suitableConfiguration } = req.body;

    // Validation
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    if (title.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Title cannot exceed 100 characters'
      });
    }

    if (description.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Description cannot exceed 500 characters'
      });
    }

    const clipData = {
      clientId,
      title: title.trim(),
      description: description.trim(),
      suitableTime: suitableTime || '',
      guided: guided || '',
      transcript: transcript || '',
      suitableConfiguration: suitableConfiguration || null
    };

    // Handle video upload to S3
    if (req.files && req.files.video) {
      const videoFile = req.files.video[0];
      const videoUpload = await uploadToS3(videoFile, 'spiritual-clips/videos');
      clipData.videoUrl = videoUpload.url;
      clipData.videoKey = videoUpload.key;
      clipData.videoFileName = videoFile.originalname;
    }

    // Handle audio upload to S3
    if (req.files && req.files.audio) {
      const audioFile = req.files.audio[0];
      const audioUpload = await uploadToS3(audioFile, 'spiritual-clips/audios');
      clipData.audioUrl = audioUpload.url;
      clipData.audioKey = audioUpload.key;
      clipData.audioFileName = audioFile.originalname;
    }

    console.log('Creating clip with data:', clipData);

    const clip = new SpiritualClip(clipData);
    await clip.save();

    console.log('Clip created successfully:', clip._id);

    // S3 URLs are already full URLs
    const responseClip = clip.toObject();

    res.status(201).json({
      success: true,
      data: responseClip,
      message: 'Clip created successfully'
    });

  } catch (error) {
    console.error('Create clip error:', error);
    
    // Clean up uploaded files from S3 if clip creation fails
    if (req.files) {
      try {
        if (req.files.video && clipData.videoKey) {
          await deleteFromS3(clipData.videoKey);
        }
        if (req.files.audio && clipData.audioKey) {
          await deleteFromS3(clipData.audioKey);
        }
      } catch (cleanupError) {
        console.error('Error cleaning up S3 files:', cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create clip',
      error: error.message
    });
  }
});

// PUT /api/spiritual-clips/:id - Update clip
router.put('/:id', authenticate, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), async (req, res) => {
  try {
    const clipId = req.params.id;

    const clip = await SpiritualClip.findById(clipId);

    if (!clip) {
      return res.status(404).json({
        success: false,
        message: 'Clip not found'
      });
    }

    const { title, description, suitableTime, guided, transcript, suitableConfiguration } = req.body;

    // Validation
    if (title && title.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Title cannot exceed 100 characters'
      });
    }

    if (description && description.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Description cannot exceed 500 characters'
      });
    }

    // Update fields
    if (title) clip.title = title.trim();
    if (description) clip.description = description.trim();
    if (suitableTime !== undefined) clip.suitableTime = suitableTime;
    if (guided !== undefined) clip.guided = guided;
    if (transcript !== undefined) clip.transcript = transcript;
    if (suitableConfiguration !== undefined) clip.suitableConfiguration = suitableConfiguration || null;

    // Handle new video upload to S3
    if (req.files && req.files.video) {
      const videoFile = req.files.video[0];
      // Delete old video file from S3 if exists
      if (clip.videoKey) {
        try {
          await deleteFromS3(clip.videoKey);
        } catch (deleteError) {
          console.error('Error deleting old video from S3:', deleteError);
        }
      }

      const videoUpload = await uploadToS3(videoFile, 'spiritual-clips/videos');
      clip.videoUrl = videoUpload.url;
      clip.videoKey = videoUpload.key;
      clip.videoFileName = videoFile.originalname;
    }

    // Handle new audio upload to S3
    if (req.files && req.files.audio) {
      const audioFile = req.files.audio[0];
      // Delete old audio file from S3 if exists
      if (clip.audioKey) {
        try {
          await deleteFromS3(clip.audioKey);
        } catch (deleteError) {
          console.error('Error deleting old audio from S3:', deleteError);
        }
      }

      const audioUpload = await uploadToS3(audioFile, 'spiritual-clips/audios');
      clip.audioUrl = audioUpload.url;
      clip.audioKey = audioUpload.key;
      clip.audioFileName = audioFile.originalname;
    }

    await clip.save();

    console.log('Clip updated successfully:', clipId);

    // Populate suitableConfiguration for response
    await clip.populate('suitableConfiguration', 'title description');

    // Generate presigned URLs for response
    const { getobject } = await import('../utils/s3.js');
    const clipObj = clip.toObject();
    
    // Ensure suitableConfiguration is always present in response
    if (!clipObj.suitableConfiguration) {
      clipObj.suitableConfiguration = null;
    }
    
    try {
      // Generate presigned URLs for video and audio
      if (clipObj.videoKey) {
        clipObj.videoUrl = await getobject(clipObj.videoKey, 3600); // 1 hour expiry
      }
      if (clipObj.audioKey) {
        clipObj.audioUrl = await getobject(clipObj.audioKey, 3600); // 1 hour expiry
      }
    } catch (error) {
      console.error('Error generating presigned URLs for clip:', clipObj._id, error);
      // Keep original URLs if presigned URL generation fails
    }

    res.json({
      success: true,
      data: clipObj,
      message: 'Clip updated successfully'
    });

  } catch (error) {
    console.error('Update clip error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to update clip',
      error: error.message
    });
  }
});

// PATCH /api/spiritual-clips/:id/toggle - Toggle clip status
router.patch('/:id/toggle', authenticate, async (req, res) => {
  try {
    const clipId = req.params.id;

    const clip = await SpiritualClip.findById(clipId);

    if (!clip) {
      return res.status(404).json({
        success: false,
        message: 'Clip not found'
      });
    }

    clip.isActive = !clip.isActive;
    await clip.save();

    console.log(`Clip ${clipId} status toggled to:`, clip.isActive);

    res.json({
      success: true,
      data: clip,
      message: `Clip ${clip.isActive ? 'enabled' : 'disabled'} successfully`
    });

  } catch (error) {
    console.error('Toggle clip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle clip status',
      error: error.message
    });
  }
});

// DELETE /api/spiritual-clips/:id - Delete clip
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const clipId = req.params.id;

    const clip = await SpiritualClip.findById(clipId);

    if (!clip) {
      return res.status(404).json({
        success: false,
        message: 'Clip not found'
      });
    }

    // Delete video file from S3 if exists
    if (clip.videoKey) {
      try {
        await deleteFromS3(clip.videoKey);
        console.log('Video file deleted from S3:', clip.videoKey);
      } catch (deleteError) {
        console.error('Error deleting video from S3:', deleteError);
      }
    }

    // Delete audio file from S3 if exists
    if (clip.audioKey) {
      try {
        await deleteFromS3(clip.audioKey);
        console.log('Audio file deleted from S3:', clip.audioKey);
      } catch (deleteError) {
        console.error('Error deleting audio from S3:', deleteError);
      }
    }

    await SpiritualClip.findByIdAndDelete(clipId);

    console.log('Clip deleted successfully:', clipId);

    res.json({
      success: true,
      message: 'Clip deleted successfully'
    });

  } catch (error) {
    console.error('Delete clip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete clip',
      error: error.message
    });
  }
});

// GET /api/spiritual-clips/:id - Get single clip
router.get('/:id', authenticate, async (req, res) => {
  try {
    const clipId = req.params.id;

    const clip = await SpiritualClip.findById(clipId)
      .populate('suitableConfiguration', 'title description');

    if (!clip) {
      return res.status(404).json({
        success: false,
        message: 'Clip not found'
      });
    }

    // Generate presigned URLs for response
    const { getobject } = await import('../utils/s3.js');
    const clipObj = clip.toObject();
    
    // Ensure suitableConfiguration is always present in response
    if (!clipObj.suitableConfiguration) {
      clipObj.suitableConfiguration = null;
    }
    
    try {
      // Generate presigned URLs for video and audio
      if (clipObj.videoKey) {
        clipObj.videoUrl = await getobject(clipObj.videoKey, 3600); // 1 hour expiry
      }
      if (clipObj.audioKey) {
        clipObj.audioUrl = await getobject(clipObj.audioKey, 3600); // 1 hour expiry
      }
    } catch (error) {
      console.error('Error generating presigned URLs for clip:', clipObj._id, error);
      // Keep original URLs if presigned URL generation fails
    }

    res.json({
      success: true,
      data: clipObj
    });

  } catch (error) {
    console.error('Get clip error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clip',
      error: error.message
    });
  }
});



export default router;