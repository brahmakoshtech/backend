import express from 'express';
import mongoose from 'mongoose';
import Client from '../models/Client.js';
import User from '../models/User.js';
import AppSettings from '../models/AppSettings.js';
import { authenticate, authorize, generateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require admin authentication
router.use(authenticate);
router.use(authorize('admin', 'super_admin'));

// Get all clients (super_admin: all; admin: those with matching adminId or unassigned)
router.get('/clients', async (req, res) => {
  try {
    const filter = req.user.role === 'super_admin'
      ? {}
      : { $or: [ { adminId: req.user._id }, { adminId: null }, { adminId: { $exists: false } } ] };
    const clients = await Client.find(filter)
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { clients }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Create client
router.post('/clients', async (req, res) => {
  try {
    const { 
      email, 
      password, 
      businessName,
      websiteUrl,
      gstNumber,
      panNumber,
      businessLogo,
      fullName,
      mobileNumber,
      address,
      city,
      pincode
    } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    // Check if client already exists
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(400).json({ 
        success: false, 
        message: 'Client already exists with this email' 
      });
    }

    // Create new client (clientId will be auto-generated)
    const client = new Client({
      email,
      password,
      businessName: businessName || '',
      websiteUrl: websiteUrl || '',
      gstNumber: gstNumber || '',
      panNumber: panNumber || '',
      businessLogo: businessLogo || '',
      fullName: fullName || '',
      mobileNumber: mobileNumber || '',
      address: address || '',
      city: city || '',
      pincode: pincode || '',
      createdBy: req.user._id,
      adminId: req.user._id,
      loginApproved: true, // Clients created by admin are auto-approved
      isActive: true
    });

    // Save client (this will trigger the pre-validate hook to generate clientId)
    await client.save();

    console.log('Client created successfully with ID:', client.clientId);

    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: { 
        client,
        clientId: client.clientId // Explicitly include the generated ID
      }
    });
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get single client
router.get('/clients/:id', async (req, res) => {
  try {
    const filter = req.user.role === 'super_admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, $or: [ { adminId: req.user._id }, { adminId: null }, { adminId: { $exists: false } } ] };
    const client = await Client.findOne(filter).select('-password');

    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    res.json({
      success: true,
      data: { client }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Update client
router.put('/clients/:id', async (req, res) => {
  try {
    const client = await Client.findOne({ 
      _id: req.params.id, 
      adminId: req.user.role === 'super_admin' ? { $exists: true } : req.user._id
    });

    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    // Prevent updating clientId
    const { clientId, ...updateData } = req.body;
    
    Object.assign(client, updateData);
    await client.save();

    res.json({
      success: true,
      message: 'Client updated successfully',
      data: { client }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Delete client (soft delete)
router.delete('/clients/:id', async (req, res) => {
  try {
    const client = await Client.findOne({ 
      _id: req.params.id, 
      adminId: req.user.role === 'super_admin' ? { $exists: true } : req.user._id
    });

    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    client.isActive = false;
    await client.save();

    res.json({
      success: true,
      message: 'Client deactivated successfully'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Activate client
router.patch('/clients/:id/activate', async (req, res) => {
  try {
    const client = await Client.findOne({ 
      _id: req.params.id, 
      adminId: req.user.role === 'super_admin' ? { $exists: true } : req.user._id
    });

    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    client.isActive = true;
    await client.save();

    res.json({
      success: true,
      message: 'Client activated successfully',
      data: { client }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get users under clients (admin credits view) with optional search + pagination
router.get('/users', async (req, res) => {
  try {
    const { search, page = 1, limit = 25 } = req.query;
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip = (pageNum - 1) * pageSize;

    const clients = await Client.find({ 
      adminId: req.user.role === 'super_admin' ? { $exists: true } : req.user._id
    }).select('_id');

    const clientIds = clients.map(c => c._id);

    const query = {
      clientId: { $in: clientIds }
    };

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { email: regex },
        { 'profile.name': regex }
      ];
    }
    
    const [users, total] = await Promise.all([
      User.find(query)
      .select('-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry')
      .populate('clientId', 'email businessName clientId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
      User.countDocuments(query)
    ]);
    
    const usersWithKarma = users.map(user => ({
      ...user,
      karmaPoints: user.karmaPoints ?? 0
    }));
    
    res.json({
      success: true,
      data: { 
        users: usersWithKarma,
        total,
        page: pageNum,
        limit: pageSize,
        hasMore: total > skip + usersWithKarma.length
      }
    });
  } catch (error) {
    console.error('[Admin API] Error in GET /users:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get dashboard overview
router.get('/dashboard/overview', async (req, res) => {
  try {
    const query = req.user.role === 'super_admin' 
      ? { adminId: { $exists: true } }
      : { adminId: req.user._id };

    const totalClients = await Client.countDocuments(query);
    const activeClients = await Client.countDocuments({ ...query, isActive: true });

    const clients = await Client.find(query).select('_id');
    const clientIds = clients.map(c => c._id);
    
    const totalUsers = await User.countDocuments({ 
      clientId: { $in: clientIds }
    });
    
    const activeUsers = await User.countDocuments({ 
      clientId: { $in: clientIds },
      isActive: true
    });

    res.json({
      success: true,
      data: {
        totalClients,
        activeClients,
        totalUsers,
        activeUsers
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Generate login token for client (admin impersonation)
router.post('/clients/:id/login-token', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    // Check if admin has permission (client belongs to this admin)
    if (req.user.role !== 'super_admin' && client.adminId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const token = generateToken(client._id, 'client');

    res.json({
      success: true,
      message: 'Login token generated successfully',
      data: {
        token,
        clientId: client._id,
        clientCode: client.clientId,
        businessName: client.businessName
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============ App Settings (e.g. Gemini API Key) ============

// @route   GET /api/admin/settings/gemini-api-key
// @desc    Get Gemini API key status (masked). Optional query: clientId (Client _id or clientId code). Admin/Super Admin only.
router.get('/settings/gemini-api-key', async (req, res) => {
  try {
    const { clientId } = req.query;
    let key = null;
    let scope = 'app';

    if (clientId) {
      const isObjectId = mongoose.Types.ObjectId.isValid(clientId) && String(clientId).length === 24;
      const client = isObjectId
        ? await Client.findById(clientId).select('clientId businessName fullName settings.geminiApiKey').lean()
        : await Client.findOne({ clientId: String(clientId) }).select('clientId businessName fullName settings.geminiApiKey').lean();
      if (!client) {
        return res.status(404).json({ success: false, message: 'Client not found' });
      }
      key = client.settings?.geminiApiKey || null;
      scope = 'client';
      const masked = key ? `${key.slice(0, 4)}****${key.slice(-4)}` : null;
      return res.json({
        success: true,
        data: {
          configured: !!key,
          masked,
          scope,
          client: { _id: client._id, clientId: client.clientId, businessName: client.businessName, fullName: client.fullName }
        }
      });
    }

    const settings = await AppSettings.getSettings();
    key = settings?.geminiApiKey;
    const masked = key ? `${key.slice(0, 4)}****${key.slice(-4)}` : null;
    res.json({
      success: true,
      data: {
        configured: !!key,
        masked,
        scope
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/settings/gemini-api-key
// @desc    Update Gemini API key. Body: { apiKey, clientId? }. If clientId provided, update that client's key; else app-level. Admin/Super Admin only.
router.put('/settings/gemini-api-key', async (req, res) => {
  try {
    const { apiKey, clientId } = req.body;
    const value = apiKey != null ? String(apiKey).trim() || null : null;

    if (clientId) {
      const isObjectId = mongoose.Types.ObjectId.isValid(clientId) && String(clientId).length === 24;
      const client = isObjectId
        ? await Client.findById(clientId)
        : await Client.findOne({ clientId: String(clientId) });
      if (!client) {
        return res.status(404).json({ success: false, message: 'Client not found' });
      }
      if (!client.settings) client.settings = {};
      client.settings.geminiApiKey = value;
      await client.save();
      const key = client.settings.geminiApiKey;
      const masked = key ? `${key.slice(0, 4)}****${key.slice(-4)}` : null;
      return res.json({
        success: true,
        message: 'Gemini API key updated for client',
        data: {
          configured: !!key,
          masked,
          scope: 'client',
          client: { _id: client._id, clientId: client.clientId, businessName: client.businessName, fullName: client.fullName }
        }
      });
    }

    const settings = await AppSettings.getSettings();
    settings.geminiApiKey = value;
    await settings.save();
    const key = settings.geminiApiKey;
    const masked = key ? `${key.slice(0, 4)}****${key.slice(-4)}` : null;
    res.json({
      success: true,
      message: 'Gemini API key updated',
      data: { configured: !!key, masked, scope: 'app' }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============ App Settings (OpenAI API Key) ============

// @route   GET /api/admin/settings/openai-api-key
// @desc    Get OpenAI API key status (masked). Optional query: clientId (Client _id or clientId code). Admin/Super Admin only.
router.get('/settings/openai-api-key', async (req, res) => {
  try {
    const { clientId } = req.query;
    let key = null;
    let scope = 'app';

    if (clientId) {
      const isObjectId = mongoose.Types.ObjectId.isValid(clientId) && String(clientId).length === 24;
      const client = isObjectId
        ? await Client.findById(clientId).select('clientId businessName fullName settings.openaiApiKey').lean()
        : await Client.findOne({ clientId: String(clientId) }).select('clientId businessName fullName settings.openaiApiKey').lean();
      if (!client) {
        return res.status(404).json({ success: false, message: 'Client not found' });
      }
      key = client.settings?.openaiApiKey || null;
      scope = 'client';
      const masked = key ? `${key.slice(0, 4)}****${key.slice(-4)}` : null;
      return res.json({
        success: true,
        data: {
          configured: !!key,
          masked,
          scope,
          client: { _id: client._id, clientId: client.clientId, businessName: client.businessName, fullName: client.fullName }
        }
      });
    }

    const settings = await AppSettings.getSettings();
    key = settings?.openaiApiKey;
    const masked = key ? `${key.slice(0, 4)}****${key.slice(-4)}` : null;
    res.json({
      success: true,
      data: {
        configured: !!key,
        masked,
        scope
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/settings/openai-api-key
// @desc    Update OpenAI API key. Body: { apiKey, clientId? }. If clientId provided, update that client's key; else app-level. Admin/Super Admin only.
router.put('/settings/openai-api-key', async (req, res) => {
  try {
    const { apiKey, clientId } = req.body;
    const value = apiKey != null ? String(apiKey).trim() || null : null;

    if (clientId) {
      const isObjectId = mongoose.Types.ObjectId.isValid(clientId) && String(clientId).length === 24;
      const client = isObjectId
        ? await Client.findById(clientId)
        : await Client.findOne({ clientId: String(clientId) });
      if (!client) {
        return res.status(404).json({ success: false, message: 'Client not found' });
      }
      if (!client.settings) client.settings = {};
      client.settings.openaiApiKey = value;
      await client.save();
      const key = client.settings.openaiApiKey;
      const masked = key ? `${key.slice(0, 4)}****${key.slice(-4)}` : null;
      return res.json({
        success: true,
        message: 'OpenAI API key updated for client',
        data: {
          configured: !!key,
          masked,
          scope: 'client',
          client: { _id: client._id, clientId: client.clientId, businessName: client.businessName, fullName: client.fullName }
        }
      });
    }

    const settings = await AppSettings.getSettings();
    settings.openaiApiKey = value;
    await settings.save();
    const key = settings.openaiApiKey;
    const masked = key ? `${key.slice(0, 4)}****${key.slice(-4)}` : null;
    res.json({
      success: true,
      message: 'OpenAI API key updated',
      data: { configured: !!key, masked, scope: 'app' }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;