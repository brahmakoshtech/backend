import express from 'express';
import crudRoutes from './crud.js';
import statsRoutes from './stats.js';
import uploadRoutes from './upload.js';

const router = express.Router();

// Mount sub-routes
router.use('/stats', statsRoutes);
router.use('/', uploadRoutes);
router.use('/', crudRoutes);

export default router;