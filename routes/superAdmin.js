import express from 'express';
import Admin from '../models/Admin.js';
import Client from '../models/Client.js';
import User from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// All routes require super admin authentication
router.use(authenticate);
router.use(authorize('super_admin'));

// Get all admins
router.get('/admins', async (req, res) => {
  try {
    const admins = await Admin.find({ role: 'admin' })
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: { admins }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Create admin
router.post('/admins', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const existingUser = await Admin.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Admin already exists with this email' 
      });
    }

    const admin = new Admin({
      email,
      password,
      role: 'admin',
      createdBy: req.user._id,
      loginApproved: true // Admins created by super admin are auto-approved
    });

    await admin.save();

    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      data: { admin }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Update admin
router.put('/admins/:id', async (req, res) => {
  try {
    const admin = await Admin.findOne({ 
      _id: req.params.id, 
      role: 'admin' 
    });

    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }

    Object.assign(admin, req.body);
    await admin.save();

    res.json({
      success: true,
      message: 'Admin updated successfully',
      data: { admin }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Delete admin
router.delete('/admins/:id', async (req, res) => {
  try {
    const admin = await Admin.findOne({ 
      _id: req.params.id, 
      role: 'admin' 
    });

    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }

    admin.isActive = false;
    await admin.save();

    res.json({
      success: true,
      message: 'Admin deactivated successfully'
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
    const totalAdmins = await Admin.countDocuments({ role: 'admin' });
    const activeAdmins = await Admin.countDocuments({ role: 'admin', isActive: true });
    const totalClients = await Client.countDocuments();
    const totalUsers = await User.countDocuments();
    const pendingAdmins = await Admin.countDocuments({ loginApproved: false, role: 'admin' });
    const pendingUsers = await User.countDocuments({ loginApproved: false });
    const pendingApprovals = pendingAdmins + pendingUsers; // Clients don't need approval

    res.json({
      success: true,
      data: {
        totalAdmins,
        activeAdmins,
        totalClients,
        totalUsers,
        pendingApprovals
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get pending login approvals
router.get('/pending-approvals', async (req, res) => {
  try {
    const pendingAdmins = await Admin.find({ 
      loginApproved: false, 
      role: 'admin' 
    }).select('-password').sort({ createdAt: -1 }).lean();
    
    const pendingUsers = await User.find({ 
      loginApproved: false 
    }).select('-password').sort({ createdAt: -1 }).lean();
    
    // Clients don't need approval, so exclude them from pending approvals
    const allPending = [
      ...pendingAdmins.map(item => ({ ...item, role: 'admin', type: 'admin' })),
      ...pendingUsers.map(item => ({ ...item, role: 'user', type: 'user' }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json({
      success: true,
      data: { pendingUsers: allPending }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Approve login for user
router.post('/approve-login/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    let user = null;

    if (type === 'admin') {
      user = await Admin.findById(id);
      if (user && user.role === 'super_admin') {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot modify super admin permissions' 
        });
      }
    } else if (type === 'client') {
      return res.status(400).json({ 
        success: false, 
        message: 'Clients do not require approval' 
      });
    } else if (type === 'user') {
      user = await User.findById(id);
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid user type' 
      });
    }
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    user.loginApproved = true;
    await user.save();

    res.json({
      success: true,
      message: 'Login approved successfully',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Reject/Revoke login approval
router.post('/reject-login/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    let user = null;

    if (type === 'admin') {
      user = await Admin.findById(id);
      if (user && user.role === 'super_admin') {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot modify super admin permissions' 
        });
      }
    } else if (type === 'client') {
      return res.status(400).json({ 
        success: false, 
        message: 'Clients do not require approval' 
      });
    } else if (type === 'user') {
      user = await User.findById(id);
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid user type' 
      });
    }
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    user.loginApproved = false;
    await user.save();

    res.json({
      success: true,
      message: 'Login approval revoked successfully',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

export default router;

