import express from 'express';
import Client from '../models/Client.js';
import User from '../models/User.js';
import { authenticate, authorize, generateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require admin authentication
router.use(authenticate);
router.use(authorize('admin', 'super_admin'));

// Get all clients
router.get('/clients', async (req, res) => {
  try {
    const clients = await Client.find({ 
      adminId: req.user.role === 'super_admin' ? { $exists: true } : req.user._id
    })
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
    const client = await Client.findOne({ 
      _id: req.params.id, 
      adminId: req.user.role === 'super_admin' ? { $exists: true } : req.user._id
    }).select('-password');

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

export default router;