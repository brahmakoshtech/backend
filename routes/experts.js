import express from 'express';
import expertRoutes from './experts/index.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use('/', authenticate, expertRoutes);

export default router;