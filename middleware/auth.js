import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import Client from '../models/Client.js';
import User from '../models/User.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production-to-a-strong-random-string';

// Authentication middleware - works with all models
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided. Authentication required.' 
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (verifyError) {
      throw verifyError;
    }
    
    // Determine model based on role in token
    let user = null;
    if (decoded.role === 'super_admin' || decoded.role === 'admin') {
      user = await Admin.findById(decoded.userId).select('-password');
      if (user) user.role = decoded.role; // Ensure role is set
    } else if (decoded.role === 'client') {
      user = await Client.findById(decoded.userId).select('-password');
      if (user) {
        user.role = 'client';
        // Ensure _id is available
        if (!user._id && decoded.userId) {
          user._id = decoded.userId;
        }
        console.log('[Auth Middleware] Client user loaded:', {
          _id: user._id?.toString(),
          clientId: user.clientId,
          email: user.email,
          role: user.role,
          isActive: user.isActive
        });
      }
    } else if (decoded.role === 'user') {
      user = await User.findById(decoded.userId)
        .select('-password')
        .populate('clientId', 'clientId businessName email');
      if (user) {
        user.role = 'user'; // Ensure role is set
        // Convert to plain object to ensure role is preserved
        user = user.toObject ? user.toObject() : user;
        user.role = 'user'; // Set role again after conversion
        
        // Add clientId from token for backward compatibility
        if (decoded.clientId) {
          user.tokenClientId = decoded.clientId;
        }
      }
    }
    
    console.log('[Auth Middleware] User found:', {
      userId: user?._id,
      role: user?.role,
      email: user?.email,
      clientId: user?.role === 'client' ? user?.clientId : (user?.clientId?._id || user?.tokenClientId),
      isActive: user?.isActive
    });
    
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

    // Ensure role is always set - prioritize token role over user object role
    if (!user.role || user.role !== decoded.role) {
      user.role = decoded.role;
    }

    // Final check - ensure role is a string and exactly matches token role
    if (user.role !== decoded.role) {
      user.role = decoded.role;
    }

    // Store decoded role and clientId in request for additional verification
    req.decodedRole = decoded.role;
    req.decodedClientId = decoded.clientId;

    console.log('[Auth Middleware] Authentication successful:', {
      userId: user._id?.toString(),
      role: user.role,
      tokenRole: decoded.role,
      clientId: user.role === 'client' ? user.clientId : (user.clientId?.clientId || decoded.clientId),
      roleMatch: user.role === decoded.role
    });

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid or expired token.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

// Generate JWT token with clientId for users
export const generateToken = (userId, role, clientId = null) => {
  const payload = { userId, role };
  
  // Add clientId to token for users
  if (role === 'user' && clientId) {
    payload.clientId = clientId;
  }
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

// Alias for authenticate function (for backward compatibility)
export const authenticateToken = authenticate;