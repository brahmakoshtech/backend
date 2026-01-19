import express from 'express';
const router = express.Router();
import { authenticate } from '../middleware/auth.js';

// Import expert category routes
import expertCategoryRoutes from './expertCategories/index.js';

// Apply authentication middleware
router.use(authenticate);

// Mount expert category routes
router.use('/', expertCategoryRoutes);

export default router;