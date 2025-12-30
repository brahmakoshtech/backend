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

    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(400).json({ 
        success: false, 
        message: 'Client already exists with this email' 
      });
    }

    const client = new Client({
      email: email || '',
      password: password || '',
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
      loginApproved: true // Clients created by admin are auto-approved
    });

    await client.save();

    res.status(201).json({
      success: true,
      message: 'Client created successfully',
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
      adminId: req.user._id
    });

    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    Object.assign(client, req.body);
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

// Delete client
router.delete('/clients/:id', async (req, res) => {
  try {
    const client = await Client.findOne({ 
      _id: req.params.id, 
      adminId: req.user._id
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

// Get users under clients
router.get('/users', async (req, res) => {
  try {
    const clients = await Client.find({ 
      adminId: req.user._id
    }).select('_id');

    const clientIds = clients.map(c => c._id);
    
    const users = await User.find({ 
      clientId: { $in: clientIds }
    })
      .select('-password')
      .populate('clientId', 'email businessName')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: { users }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get dashboard overview
router.get('/dashboard/overview', async (req, res) => {
  try {
    const totalClients = await Client.countDocuments({ 
      adminId: req.user._id
    });

    const clients = await Client.find({ 
      adminId: req.user._id
    }).select('_id');

    const clientIds = clients.map(c => c._id);
    const totalUsers = await User.countDocuments({ 
      clientId: { $in: clientIds }
    });

    res.json({
      success: true,
      data: {
        totalClients,
        totalUsers
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
      data: {
        token,
        clientId: client._id
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

