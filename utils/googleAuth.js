/**
 * Google OAuth Utility
 * Verifies Google ID tokens and extracts user information
 */

import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Google OAuth client
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Verify Google ID token and extract user information
 * @param {string} idToken - Google ID token from mobile app
 * @returns {Object} User information from Google
 */
export const verifyGoogleToken = async (idToken) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new Error('Google Client ID is not configured');
    }

    // Verify the token
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    
    if (!payload) {
      throw new Error('Invalid Google token payload');
    }

    // Extract user information
    return {
      googleId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified || false,
      name: payload.name,
      picture: payload.picture,
      givenName: payload.given_name,
      familyName: payload.family_name,
    };
  } catch (error) {
    console.error('Google token verification error:', error);
    throw new Error('Invalid Google token: ' + error.message);
  }
};

/**
 * Check if Google OAuth is enabled
 */
export const isGoogleOAuthEnabled = () => {
  return !!process.env.GOOGLE_CLIENT_ID;
};




