import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import Client from '../models/Client.js';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Authentication middleware - works with all models
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    // Debug logging
    console.log('[Auth Middleware]', {
      path: req.path,
      method: req.method,
      hasAuthHeader: !!authHeader,
      hasToken: !!token,
      tokenLength: token ? token.length : 0,
      tokenPreview: token ? token.substring(0, 20) + '...' : 'none'
    });
    
    if (!token) {
      console.warn('[Auth Middleware] No token provided for:', req.path);
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided. Authentication required.' 
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
      console.log('[Auth Middleware] Token decoded successfully:', {
        userId: decoded.userId,
        role: decoded.role,
        path: req.path,
        tokenIssuedAt: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : null,
        tokenExpiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null
      });
    } catch (verifyError) {
      console.error('[Auth Middleware] Token verification failed:', {
        error: verifyError.message,
        errorName: verifyError.name,
        path: req.path,
        tokenPreview: token.substring(0, 50) + '...'
      });
      throw verifyError;
    }
    
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
      if (user) {
        user.role = 'user'; // Ensure role is set
        // Convert to plain object to ensure role is preserved
        user = user.toObject ? user.toObject() : user;
        user.role = 'user'; // Set role again after conversion
      }
    }
    
    console.log('[Auth Middleware] User found:', {
      userId: user?._id,
      role: user?.role,
      email: user?.email,
      isActive: user?.isActive,
      path: req.path
    });
    
    if (!user) {
      console.error('[Auth Middleware] User not found for userId:', decoded.userId);
      return res.status(401).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    if (!user.isActive) {
      console.warn('[Auth Middleware] User account inactive:', user._id);
      return res.status(401).json({ 
        success: false, 
        message: 'User account is inactive.' 
      });
    }

    // Ensure role is always set - prioritize token role over user object role
    // This is important because token role is the source of truth
    if (!user.role || user.role !== decoded.role) {
      console.warn('[Auth Middleware] Role mismatch or missing, using token role:', {
        tokenRole: decoded.role,
        userRole: user.role,
        userId: user._id,
        path: req.path
      });
      // Use role from token (source of truth)
      user.role = decoded.role;
    }

    // Final check - ensure role is a string and exactly matches token role
    if (user.role !== decoded.role) {
      console.error('[Auth Middleware] Critical role mismatch, forcing token role:', {
        tokenRole: decoded.role,
        userRole: user.role,
        userId: user._id,
        path: req.path
      });
      // Force role to match token (token is source of truth)
      user.role = decoded.role;
    }

    // Store decoded role in request for additional verification
    req.decodedRole = decoded.role;

    console.log('[Auth Middleware] Authentication successful:', {
      userId: user._id?.toString(),
      role: user.role,
      tokenRole: decoded.role,
      roleMatch: user.role === decoded.role,
      roleType: typeof user.role,
      path: req.path,
      userModel: user.constructor?.name || 'plain object'
    });

    req.user = user;
    next();
  } catch (error) {
    console.error('[Auth Middleware] Error:', {
      error: error.message,
      errorName: error.name,
      path: req.path,
      hasToken: !!req.header('Authorization')
    });
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

// Generate JWT token
export const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '7d' });
};

// Alias for authenticate function (for backward compatibility)
export const authenticateToken = authenticate;
