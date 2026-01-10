import express from 'express';
import Client from '../../models/Client.js';
import { generateToken, authenticate } from '../../middleware/auth.js';

const router = express.Router();

// Client Login
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
        user: { ...client.toObject(), role: 'client' },
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

// Client Registration
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
      businessName,
      businessType,
      contactNumber,
      address,
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

// Get current client
router.get('/me', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user
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


