import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { getPresignedUrl, deleteFile, generateUploadUrl } from '../utils/storage.js';

const router = express.Router();
router.use(authenticate);

// Generate presigned URL for upload (PUT)
router.post('/presigned-url', async (req, res) => {
  try {
    const { fileName, contentType } = req.body;
    if (!fileName || !contentType) {
      return res.status(400).json({ success: false, message: 'fileName and contentType are required' });
    }
    const folder = `images/${req.user.role}/${req.user._id}`;
    const { uploadUrl, key } = await generateUploadUrl(fileName, contentType, folder);
    res.json({ success: true, data: { presignedUrl: uploadUrl, key } });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate presigned URL' });
  }
});

// Get presigned URL for viewing a file
router.get('/presigned-url/:key(*)', async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const presignedUrl = await getPresignedUrl(key);
    res.json({ success: true, data: { presignedUrl } });
  } catch (error) {
    console.error('Error generating get presigned URL:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate presigned URL' });
  }
});

// Delete a file
router.delete('/:key(*)', async (req, res) => {
  try {
    await deleteFile(req.params.key);
    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete file' });
  }
});

export default router;
