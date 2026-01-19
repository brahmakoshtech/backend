import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production-to-a-strong-random-string';

// Extract clientId from JWT token
export const getClientIdFromToken = (req) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // For client role, return the clientId from user object
    if (decoded.role === 'client') {
      return req.user?.clientId;
    }
    
    // For user role, return clientId from token
    if (decoded.role === 'user') {
      return decoded.clientId;
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting clientId from token:', error.message);
    return null;
  }
};