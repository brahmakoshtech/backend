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

  const hasProjectId = !!process.env.FIREBASE_PROJECT_ID;
  const hasServiceAccountKey = !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const hasClientEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
  const hasPrivateKey = !!process.env.FIREBASE_PRIVATE_KEY;

  if (!hasProjectId) {
    console.warn('[FirebaseAdmin] Not configured: FIREBASE_PROJECT_ID is missing. ' + 
      `FIREBASE_SERVICE_ACCOUNT_KEY=${hasServiceAccountKey}, FIREBASE_CLIENT_EMAIL=${hasClientEmail}, FIREBASE_PRIVATE_KEY=${hasPrivateKey}`);
    return null;
  }

  try {
    let initMode = 'default_credentials';

    // Option 1: Use service account JSON (recommended for production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      initMode = 'service_account_json';
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
    }
    // Option 2: Use individual environment variables
    else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      initMode = 'client_email_private_key';
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
      initMode = 'default_credentials';
      firebaseApp = admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
    }

    console.log('[FirebaseAdmin] Initialized successfully:', {
      initMode,
      projectId: process.env.FIREBASE_PROJECT_ID ? String(process.env.FIREBASE_PROJECT_ID).slice(0, 6) + '...' : null
    });
    return firebaseApp;
  } catch (error) {
    console.error('[FirebaseAdmin] Initialization error:', error);
    throw new Error('Failed to initialize Firebase Admin SDK: ' + error.message);
  }
};

/**
 * Ensure Firebase Admin is initialized (for Auth, FCM, etc.)
 * @returns {import('firebase-admin').app.App | null}
 */
export const ensureFirebaseApp = () => {
  if (firebaseApp) {
    // Avoid noisy logs every request; only log on first initialization path.
    return firebaseApp;
  }
  return initializeFirebase();
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

