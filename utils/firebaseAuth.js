/**
 * Firebase Authentication Utility
 * Verifies Firebase ID tokens and extracts user information
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase Admin SDK
let firebaseApp = null;

const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn('Firebase is not configured. FIREBASE_PROJECT_ID is missing.');
    return null;
  }

  try {
    // Option 1: Use service account JSON (recommended for production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
    }
    // Option 2: Use individual environment variables
    else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
    }
    // Option 3: Use default credentials (for Google Cloud environments)
    else {
      firebaseApp = admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
    }

    console.log('Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    throw new Error('Failed to initialize Firebase Admin SDK: ' + error.message);
  }
};

/**
 * Verify Firebase ID token and extract user information
 * @param {string} idToken - Firebase ID token from mobile app
 * @returns {Object} User information from Firebase
 */
export const verifyFirebaseToken = async (idToken) => {
  try {
    if (!process.env.FIREBASE_PROJECT_ID) {
      throw new Error('Firebase is not configured. FIREBASE_PROJECT_ID is missing.');
    }

    // Initialize Firebase if not already initialized
    if (!firebaseApp) {
      initializeFirebase();
    }

    if (!firebaseApp) {
      throw new Error('Firebase Admin SDK is not initialized');
    }

    // Verify the token
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    if (!decodedToken) {
      throw new Error('Invalid Firebase token');
    }

    // Extract user information
    // Handle Google sign in provider
    const providerId = decodedToken.firebase?.sign_in_provider || 
                      decodedToken.firebase?.identities?.google?.[0] ? 'google.com' : 
                      'firebase';
    
    // Get name from different possible fields
    const name = decodedToken.name || 
                 decodedToken.display_name || 
                 (decodedToken.firebase?.identities?.google?.[0] ? decodedToken.name : null) ||
                 null;
    
    return {
      firebaseId: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified || false,
      name: name,
      picture: decodedToken.picture || null,
      phoneNumber: decodedToken.phone_number || null,
      providerId: providerId,
      // Additional info for Google sign in
      googleId: decodedToken.firebase?.identities?.google?.[0] || null,
    };
  } catch (error) {
    console.error('Firebase token verification error:', error);
    
    // Check if it's a Google ID token (common mistake)
    if (idToken && idToken.includes('accounts.google.com')) {
      throw new Error('You sent a Google ID token. Please use Firebase ID token instead. In your mobile app, after signing in with Google, authenticate with Firebase Auth to get the Firebase ID token.');
    }
    
    if (error.code === 'auth/id-token-expired') {
      throw new Error('Firebase token has expired. Please refresh the token in your mobile app.');
    } else if (error.code === 'auth/id-token-revoked') {
      throw new Error('Firebase token has been revoked');
    } else if (error.code === 'auth/argument-error') {
      throw new Error('Invalid Firebase token format. Make sure you are sending a Firebase ID token (from Firebase Auth), not a Google ID token.');
    }
    throw new Error('Invalid Firebase token: ' + error.message);
  }
};

/**
 * Check if Firebase Authentication is enabled
 */
export const isFirebaseAuthEnabled = () => {
  return !!process.env.FIREBASE_PROJECT_ID;
};

/**
 * Get Firebase user by UID
 */
export const getFirebaseUser = async (uid) => {
  try {
    if (!firebaseApp) {
      initializeFirebase();
    }

    if (!firebaseApp) {
      throw new Error('Firebase Admin SDK is not initialized');
    }

    const userRecord = await admin.auth().getUser(uid);
    return {
      uid: userRecord.uid,
      email: userRecord.email,
      emailVerified: userRecord.emailVerified || false,
      displayName: userRecord.displayName,
      photoURL: userRecord.photoURL,
      phoneNumber: userRecord.phoneNumber,
      providerId: userRecord.providerData[0]?.providerId || 'firebase',
    };
  } catch (error) {
    console.error('Error getting Firebase user:', error);
    throw new Error('Failed to get Firebase user: ' + error.message);
  }
};

