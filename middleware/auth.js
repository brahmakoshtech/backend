import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import Client from '../models/Client.js';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Authentication middleware - works with all models
export const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided. Authentication required.' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Determine model based on role in token
    let user = null;
    if (decoded.role === 'super_admin' || decoded.role === 'admin') {
      user = await Admin.findById(decoded.userId).select('-password');
      if (user) user.role = decoded.role; // Ensure role is set
    } else if (decoded.role === 'client') {
      user = await Client.findById(decoded.userId).select('-password');
      if (user) user.role = 'client';
    } else if (decoded.role === 'user') {
      user = await User.findById(decoded.userId).select('-password');
      if (user) user.role = 'user';
    }
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'User account is inactive.' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid or expired token.' 
    });
  }
};

// Role-based authorization middleware
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required.' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Insufficient permissions.' 
      });
    }

    next();
  };
};

// Generate JWT token
export const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '7d' });
};
