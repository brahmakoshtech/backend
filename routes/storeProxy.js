import express from 'express';
import axios from 'axios';

const router = express.Router();

const STORE_BASE_URL = process.env.STORE_BASE_URL || 'https://store.brahmakosh.com';

const forward = async (req, res, method, storePath, options = {}) => {
  try {
    const url = `${STORE_BASE_URL}${storePath}`;

    const headers = {
      'Content-Type': 'application/json',
    };

    // Forward Authorization header if present (Bearer token from /token-by-email or login)
    if (req.headers.authorization) {
      headers.Authorization = req.headers.authorization;
    }

    const config = {
      method,
      url,
      headers,
      params: options.params || undefined,
      data: options.body !== undefined ? options.body : req.body,
    };

    const response = await axios(config);
    return res.status(response.status || 200).json(response.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    console.error('[StoreProxy] Error forwarding request:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to contact store API',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

// 1. Auth & User Management ----------------------------------------------------

// Register user -> POST /api/store/users/register
router.post('/users/register', async (req, res) => {
  await forward(req, res, 'post', '/api/users/register');
});

// Login user -> POST /api/store/users/login
router.post('/users/login', async (req, res) => {
  await forward(req, res, 'post', '/api/users/login');
});

// Get user profile (requires Authorization header) -> GET /api/store/users/profile
router.get('/users/profile', async (req, res) => {
  await forward(req, res, 'get', '/api/users/profile');
});

// 2. Products ------------------------------------------------------------------

// Get products -> GET /api/store/products?keyword=&category=&subcategory=
router.get('/products', async (req, res) => {
  const params = {
    keyword: req.query.keyword,
    category: req.query.category,
    subcategory: req.query.subcategory,
  };
  await forward(req, res, 'get', '/api/products', { params });
});

// Create product (admin only) – JSON proxy (does not handle files)
router.post('/products', async (req, res) => {
  await forward(req, res, 'post', '/api/products');
});

// 3. Cart & Checkout ----------------------------------------------------------

// Update cart -> POST /api/store/cart
router.post('/cart', async (req, res) => {
  await forward(req, res, 'post', '/api/cart');
});

// Process checkout -> POST /api/store/checkout
router.post('/checkout', async (req, res) => {
  await forward(req, res, 'post', '/api/checkout');
});

// 4. Payment -------------------------------------------------------------------

// Create payment session -> POST /api/store/payment/create-checkout-session
router.post('/payment/create-checkout-session', async (req, res) => {
  await forward(req, res, 'post', '/api/payment/create-checkout-session');
});

// Verify payment -> POST /api/store/payment/verify
router.post('/payment/verify', async (req, res) => {
  await forward(req, res, 'post', '/api/payment/verify');
});

// 5. Addresses -----------------------------------------------------------------

// Add address -> POST /api/store/user/address/add
router.post('/user/address/add', async (req, res) => {
  await forward(req, res, 'post', '/api/user/address/add');
});

// List addresses -> GET /api/store/user/address/list
router.get('/user/address/list', async (req, res) => {
  await forward(req, res, 'get', '/api/user/address/list');
});

// 6. Dynamic Content (CMS) -----------------------------------------------------

// Get content -> GET /api/store/content?section=navbar
router.get('/content', async (req, res) => {
  const params = { section: req.query.section };
  await forward(req, res, 'get', '/api/content', { params });
});

export default router;

