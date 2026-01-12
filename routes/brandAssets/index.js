import express from 'express';
import crudRoutes from './crud.js';

const router = express.Router();

router.use('/', crudRoutes);

export default router;