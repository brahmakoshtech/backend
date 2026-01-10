import express from 'express';
import crudRoutes from './crud.js';

const router = express.Router();

console.log('FounderMessage index.js loaded');

// Use CRUD routes
router.use('/', crudRoutes);

export default router;