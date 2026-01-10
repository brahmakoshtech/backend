import express from 'express';
import Client from '../../models/Client.js';
import { generateToken, authenticate } from '../../middleware/auth.js';

const router = express.Router();

// Client Login (Mobile)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const client = await Client.findOne({ email });
    if (!client) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    const isPasswordValid = await client.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (!client.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    // Clients don't need approval, loginApproved check removed

    const token = generateToken(client._id, 'client');

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        client: { 
          ...client.toObject(), 
          role: 'client' 
        },
        token
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Client Registration (Mobile)
router.post('/register', async (req, res) => {
  try {
    const { email, password, businessName, businessType, contactNumber, address } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(400).json({ 
        success: false, 
        message: 'Client already exists with this email' 
      });
    }

    const client = new Client({
      email,
      password,
      businessName: businessName || '',
      businessType: businessType || '',
      contactNumber: contactNumber || '',
      address: address || '',
      loginApproved: true // Clients don't need approval
    });

    await client.save();

    res.status(201).json({
      success: true,
      message: 'Client registered successfully. You can login now.',
      data: {
        client: client.toObject()
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get Client Profile (Mobile)
router.get('/profile', authenticate, async (req, res) => {
  try {
    // Verify it's a client
    if (req.user.role !== 'client') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Client access required.' 
      });
    }

    const client = await Client.findById(req.user._id).select('-password');
    
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    res.json({
      success: true,
      data: {
        client: { ...client.toObject(), role: 'client' }
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Update Client Profile (Mobile)
router.put('/profile', authenticate, async (req, res) => {
  try {
    // Verify it's a client
    if (req.user.role !== 'client') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Client access required.' 
      });
    }

    const client = await Client.findById(req.user._id);
    
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      });
    }

    // Update allowed fields
    const allowedFields = ['businessName', 'businessType', 'contactNumber', 'address', 'email'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        client[field] = req.body[field];
      }
    });

    // Update password if provided
    if (req.body.password) {
      client.password = req.body.password;
    }

    await client.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        client: { ...client.toObject(), role: 'client' }
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

