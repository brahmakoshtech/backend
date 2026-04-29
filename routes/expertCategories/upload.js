import multer from 'multer';
import ExpertCategory from '../../models/ExpertCategory.js';
import { getClientIdFromToken } from '../../utils/auth.js';
import { uploadBuffer, deleteFile, getPresignedUrl } from '../../utils/storage.js';

// Configure multer for memory storage
const storage = multer.memoryStorage();
export const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
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
    const clientId = await getClientIdFromToken(req);

    if (!clientId) {
      return res.status(401).json({ success: false, error: 'Unauthorized access' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }

    const category = await ExpertCategory.findOne({ _id: categoryId, clientId, isDeleted: false });
    if (!category) {
      return res.status(404).json({ success: false, error: 'Expert category not found' });
    }

    // Delete old image if exists
    if (category.imageKey) {
      try {
        await deleteFile(category.imageKey);
      } catch (deleteError) {
        console.error('Error deleting old image:', deleteError);
      }
    }

    // Upload to storage (R2/S3/both based on settings)
    const key = `expert-categories/${Date.now()}-${req.file.originalname.replace(/\s+/g, '_')}`;
    await uploadBuffer(req.file.buffer, key, req.file.mimetype);

    category.image = key;
    category.imageKey = key;
    await category.save();

    // Return presigned URL
    let imageUrl = null;
    try {
      imageUrl = await getPresignedUrl(key);
    } catch (e) {
      console.error('Error generating presigned URL:', e);
    }

    res.json({ success: true, data: { imageUrl } });
  } catch (error) {
    console.error('Upload category image error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload image' });
  }
};
