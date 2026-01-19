import express from 'express';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import User from '../../models/User.js';
import { OAuth2Client } from 'google-auth-library';
import Client from '../../models/Client.js';
import { generateToken, authenticate } from '../../middleware/auth.js';
import {
  generateOTP,
  getOTPExpiry,
  validateOTP,
  sendEmailOTP,
  sendMobileOTP,
  sendWhatsAppOTP,
} from '../../utils/otp.js';
import { verifyFirebaseToken, isFirebaseAuthEnabled } from '../../utils/firebaseAuth.js';
import { putobject, getobject, s3Client, deleteObject } from '../../utils/s3.js';

const router = express.Router();

// Multer config for direct image uploads (memory storage, 5MB limit, images only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Helper function to validate and get client
async function validateClientId(clientCode) {
  if (!clientCode) {
    throw new Error('Client ID is required');
  }

  const client = await Client.findOne({ clientId: clientCode.toUpperCase() });
  
  if (!client) {
    throw new Error('Invalid Client ID');
  }

  if (!client.isActive) {
    throw new Error('Client account is inactive');
  }

  return client;
}

// Google Sign-In Registration/Login
router.post('/register/google', async (req, res) => {
  try {
    const { credential, clientId: clientCode } = req.body;

    // Validate required fields
    if (!credential) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google credential is required' 
      });
    }

    if (!clientCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Client ID is required' 
      });
    }

    // Verify Google token
    let payload;
    try {
      const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyError) {
      console.error('Google token verification failed:', verifyError);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid Google credential' 
      });
    }

    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;
    const emailVerified = payload.email_verified;

    // Find client by clientId string field (NOT by _id)
    const clientDoc = await Client.findOne({ clientId: clientCode.toUpperCase() });
    if (!clientDoc) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid client ID. Please contact your organization.' 
      });
    }

    if (!clientDoc.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'Client account is inactive. Please contact administrator.' 
      });
    }

    // Check if user already exists with this email and client's ObjectId
    let user = await User.findOne({ 
      email, 
      clientId: clientDoc._id  // Use ObjectId here, not the string
    });
    
    if (user) {
      // Existing user - perform login
      
      // Update profile data if changed
      let updated = false;
      
      if (picture && user.profileImage !== picture) {
        user.profileImage = picture;
        updated = true;
      }
      
      if (user.authMethod !== 'google') {
        user.authMethod = 'google';
        updated = true;
      }
      
      if (name) {
        if (!user.profile) user.profile = {};
        if (!user.profile.name) {
          user.profile.name = name;
          updated = true;
        }
      }
      
      if (updated) {
        await user.save();
      }

      const token = generateToken(user._id, 'user', user.clientId);
      
      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: {
            id: user._id,
            email: user.email,
            name: user.profile?.name || name,
            mobile: user.mobile,
            profileImage: user.profileImage,
            profile: user.profile
          },
          clientId: clientDoc.clientId,  // Return the string clientId
          clientName: clientDoc.businessName || clientDoc.name
        }
      });
    } else {
      // New user - create account
      user = new User({
        email,
        password: 'google_auth_' + Date.now(),
        authMethod: 'google',
        profile: {
          name: name
        },
        profileImage: picture,
        clientId: clientDoc._id,  // Store ObjectId here
        emailVerified: emailVerified || true,
        mobileVerified: false,
        registrationStep: 3,  // Google users are fully registered
        loginApproved: true,
        isActive: true
      });

      await user.save();

      const token = generateToken(user._id, 'user', user.clientId);

      return res.status(201).json({
        success: true,
        message: 'Account created successfully with Google',
        data: {
          token,
          user: {
            id: user._id,
            email: user.email,
            name: user.profile?.name,
            mobile: user.mobile,
            profileImage: user.profileImage,
            profile: user.profile
          },
          clientId: clientDoc.clientId,  // Return the string clientId
          clientName: clientDoc.businessName || clientDoc.name
        }
      });
    }
  } catch (error) {
    console.error('Google Sign-In Error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Google authentication failed' 
    });
  }
});
// ============================================
// FIREBASE AUTHENTICATION
// ============================================

/**
 * Sign Up with Firebase
 * POST /api/mobile/user/register/firebase
 * Body: { idToken, clientId }
 */
router.post('/register/firebase', async (req, res) => {
  try {
    const { idToken, clientId: clientCode } = req.body;

    if (!idToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firebase ID token is required' 
      });
    }

    if (!isFirebaseAuthEnabled()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firebase Authentication is not configured' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    // Verify Firebase token and get user info
    const firebaseUser = await verifyFirebaseToken(idToken);

    if (!firebaseUser.email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firebase account must have an email address' 
      });
    }
    
    const isEmailVerified = firebaseUser.emailVerified || firebaseUser.providerId === 'google.com';

    // Check if user already exists for this client
    let user = await User.findOne({ 
      clientId: client._id,
      $or: [
        { email: firebaseUser.email },
        { firebaseId: firebaseUser.firebaseId }
      ]
    });

    if (user) {
      if (user.registrationStep === 3) {
        return res.status(400).json({ 
          success: false, 
          message: 'User already registered. Please use sign in with Firebase instead.' 
        });
      }

      user.firebaseId = firebaseUser.firebaseId;
      user.authMethod = 'firebase';
      user.emailVerified = isEmailVerified;
      
      if (firebaseUser.name && !user.profile?.name) {
        user.profile = user.profile || {};
        user.profile.name = firebaseUser.name;
      }
      
      await user.save();
    } else {
      user = new User({
        email: firebaseUser.email,
        firebaseId: firebaseUser.firebaseId,
        authMethod: 'firebase',
        emailVerified: isEmailVerified,
        password: 'temp_password_' + Date.now(),
        registrationStep: 0,
        clientId: client._id,
        clientCode: client.clientId,
        profile: {
          name: firebaseUser.name || ''
        }
      });
      await user.save();
    }

    res.json({
      success: true,
      message: 'Firebase sign up successful. You can proceed with mobile verification or profile completion.',
      data: {
        user: { ...user.toObject(), role: 'user' },
        email: user.email,
        emailVerified: user.emailVerified,
        mobileVerified: user.mobileVerified || false,
        profileCompleted: user.registrationStep === 3,
        authMethod: 'firebase',
        clientId: client.clientId,
        clientName: client.businessName
      }
    });
  } catch (error) {
    console.error('Firebase sign up error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Firebase sign up failed' 
    });
  }
});

/**
 * Sign In with Firebase
 * POST /api/mobile/user/login/firebase
 * Body: { idToken, clientId }
 */
router.post('/login/firebase', async (req, res) => {
  try {
    const { idToken, clientId: clientCode } = req.body;

    if (!idToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firebase ID token is required' 
      });
    }

    if (!isFirebaseAuthEnabled()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firebase Authentication is not configured' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    // Verify Firebase token and get user info
    const firebaseUser = await verifyFirebaseToken(idToken);

    if (!firebaseUser.email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firebase account must have an email address' 
      });
    }

    // Find user by email or Firebase ID for this specific client
    let user = await User.findOne({ 
      clientId: client._id,
      $or: [
        { email: firebaseUser.email },
        { firebaseId: firebaseUser.firebaseId }
      ]
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found for this client. Please sign up first.' 
      });
    }

    if (user.registrationStep < 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Registration incomplete. Please complete profile.',
        data: {
          registrationStep: user.registrationStep,
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified,
          profileCompleted: user.registrationStep === 3
        }
      });
    }

    if (!user.firebaseId) {
      user.firebaseId = firebaseUser.firebaseId;
      user.authMethod = 'firebase';
      await user.save();
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    const token = generateToken(user._id, 'user', user.clientId);

    res.json({
      success: true,
      message: 'Firebase sign in successful',
      data: {
        user: { ...user.toObject(), role: 'user' },
        token,
        authMethod: 'firebase',
        clientId: client.clientId,
        clientName: client.businessName
      }
    });
  } catch (error) {
    console.error('Firebase sign in error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Firebase sign in failed' 
    });
  }
});

// ============================================
// REGISTRATION FLOW - MULTI-STEP
// ============================================

/**
 * STEP 1: Email OTP Verification
 * POST /api/mobile/user/register/step1
 * Body: { email, password, clientId }
 */
router.post('/register/step1', async (req, res) => {
  try {
    const { email, password, clientId: clientCode } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    // Check if user already exists for this client
    let user = await User.findOne({ 
      clientId: client._id, 
      email 
    }).select('+emailOtp +emailOtpExpiry');
    
    if (user && user.registrationStep === 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'User already registered with this email for this client' 
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    if (user) {
      user.emailOtp = otp;
      user.emailOtpExpiry = otpExpiry;
      if (password) {
        user.password = password;
      }
      if (!user.emailVerified) {
        user.emailVerified = false;
      }
      await user.save();
    } else {
      user = new User({
        email,
        password: password || 'temp_password_' + Date.now(),
        emailOtp: otp,
        emailOtpExpiry: otpExpiry,
        registrationStep: 0,
        emailVerified: false,
        clientId: client._id,
        clientCode: client.clientId
      });
      await user.save();
    }

    // Send OTP to email
    const emailResult = await sendEmailOTP(email, otp);
    if (!emailResult.success) {
      console.warn('Email OTP sending had issues, but continuing:', emailResult.message);
    }

    res.json({
      success: true,
      message: 'OTP sent to your email. Please verify to continue.',
      data: {
        email: user.email,
        registrationStep: 1,
        clientId: client.clientId,
        clientName: client.businessName
      }
    });
  } catch (error) {
    console.error('Step 1 registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to initiate registration' 
    });
  }
});

/**
 * STEP 1 VERIFY: Verify Email OTP
 * POST /api/mobile/user/register/step1/verify
 * Body: { email, otp, clientId }
 */
router.post('/register/step1/verify', async (req, res) => {
  try {
    const { email, otp, clientId: clientCode } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and OTP are required' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    const user = await User.findOne({ 
      clientId: client._id, 
      email 
    }).select('+emailOtp +emailOtpExpiry');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please start registration again.' 
      });
    }

    // Validate OTP
    const validation = validateOTP(user.emailOtp, otp, user.emailOtpExpiry);
    if (!validation.valid) {
      return res.status(400).json({ 
        success: false, 
        message: validation.message 
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailOtp = undefined;
    user.emailOtpExpiry = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        email: user.email,
        emailVerified: true,
        mobileVerified: user.mobileVerified || false,
        profileCompleted: user.registrationStep === 3,
        clientId: client.clientId
      }
    });
  } catch (error) {
    console.error('Email OTP verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to verify email OTP' 
    });
  }
});

/**
 * STEP 2: Mobile OTP Verification
 * POST /api/mobile/user/register/step2
 * Body: { email, mobile, otpMethod: 'twilio' | 'gupshup' | 'whatsapp', clientId }
 */
router.post('/register/step2', async (req, res) => {
  try {
    const { email, mobile, otpMethod, clientId: clientCode } = req.body;

    if (!mobile) {
      return res.status(400).json({ 
        success: false, 
        message: 'Mobile number is required' 
      });
    }

    if (!otpMethod || !['twilio', 'gupshup', 'whatsapp'].includes(otpMethod)) {
      return res.status(400).json({ 
        success: false, 
        message: 'OTP method is required (twilio, gupshup, or whatsapp)' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    // Validate mobile format
    const mobileRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
    if (!mobileRegex.test(mobile)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid mobile number format' 
      });
    }

    // Find user by email for this client
    let user = null;
    if (email) {
      user = await User.findOne({ 
        clientId: client._id, 
        email 
      }).select('+mobileOtp +mobileOtpExpiry');
    }
    
    if (!user) {
      user = await User.findOne({ 
        clientId: client._id, 
        mobile 
      }).select('+mobileOtp +mobileOtpExpiry');
    }
    
    if (!user) {
      user = new User({
        email: email || `mobile_${mobile}@temp.com`,
        password: 'temp_password_' + Date.now(),
        registrationStep: 0,
        emailVerified: false,
        mobileVerified: false,
        clientId: client._id,
        clientCode: client.clientId
      });
    }

    // Check if mobile is already registered to another user in this client
    const existingMobileUser = await User.findOne({ 
      clientId: client._id,
      mobile, 
      _id: { $ne: user._id },
      mobileVerified: true 
    });
    
    if (existingMobileUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Mobile number already registered for this client' 
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    user.mobile = mobile;
    user.mobileOtp = otp;
    user.mobileOtpExpiry = otpExpiry;
    user.mobileOtpMethod = otpMethod;
    if (!user.mobileVerified) {
      user.mobileVerified = false;
    }
    await user.save();

    // Send OTP based on method
    let otpResult;
    if (otpMethod === 'whatsapp') {
      otpResult = await sendMobileOTP(mobile, otp, 'whatsapp');
    } else if (otpMethod === 'gupshup') {
      otpResult = await sendMobileOTP(mobile, otp, 'gupshup');
    } else {
      otpResult = await sendMobileOTP(mobile, otp, 'twilio');
    }
    
    if (!otpResult.success) {
      console.warn(`${otpMethod.toUpperCase()} OTP sending had issues, but continuing:`, otpResult.message);
    }

    res.json({
      success: true,
      message: `OTP sent to your mobile via ${otpMethod.toUpperCase()}. Please verify to continue.`,
      data: {
        email: user.email,
        mobile: user.mobile,
        otpMethod,
        registrationStep: 2,
        clientId: client.clientId
      }
    });
  } catch (error) {
    console.error('Step 2 registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to send mobile OTP' 
    });
  }
});

/**
 * STEP 2 VERIFY: Verify Mobile OTP
 * POST /api/mobile/user/register/step2/verify
 * Body: { email, mobile, otp, clientId }
 */
router.post('/register/step2/verify', async (req, res) => {
  try {
    const { email, mobile, otp, clientId: clientCode } = req.body;

    if (!otp || (!email && !mobile)) {
      return res.status(400).json({ 
        success: false, 
        message: 'OTP and either email or mobile number are required' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    // Find user by email or mobile for this client
    let user = null;
    if (email) {
      user = await User.findOne({ 
        clientId: client._id, 
        email 
      }).select('+mobileOtp +mobileOtpExpiry');
    }
    if (!user && mobile) {
      user = await User.findOne({ 
        clientId: client._id, 
        mobile 
      }).select('+mobileOtp +mobileOtpExpiry');
    }
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please send mobile OTP first (step 2).' 
      });
    }
    
    if (!user.mobileOtp) {
      return res.status(400).json({ 
        success: false, 
        message: 'No OTP found. Please send mobile OTP first (step 2).' 
      });
    }

    // Validate OTP
    const validation = validateOTP(user.mobileOtp, otp, user.mobileOtpExpiry);
    if (!validation.valid) {
      return res.status(400).json({ 
        success: false, 
        message: validation.message 
      });
    }

    // Mark mobile as verified
    user.mobileVerified = true;
    user.mobileOtp = undefined;
    user.mobileOtpExpiry = undefined;
    user.mobileOtpMethod = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Mobile verified successfully',
      data: {
        email: user.email,
        mobile: user.mobile,
        mobileVerified: true,
        emailVerified: user.emailVerified || false,
        profileCompleted: user.registrationStep === 3,
        clientId: client.clientId
      }
    });
  } catch (error) {
    console.error('Mobile OTP verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to verify mobile OTP' 
    });
  }
});

/**
 * STEP 3: Complete Profile
 * POST /api/mobile/user/register/step3
 * Body: { 
 *   email (required),
 *   clientId (required),
 *   name (optional),
 *   dob (optional),
 *   timeOfBirth (optional),
 *   placeOfBirth (optional),
 *   latitude (optional),
 *   longitude (optional),
 *   gowthra (optional)
 * }
 */
router.post('/register/step3', async (req, res) => {
  try {
    const { 
      email, 
      clientId: clientCode,
      name, 
      dob, 
      timeOfBirth, 
      placeOfBirth,
      latitude,
      longitude,
      gowthra
    } = req.body;

    const { mobile } = req.body;
    
    if (!email && !mobile) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email or mobile number is required' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    // Find user by email or mobile for this client
    let user = null;
    if (email) {
      user = await User.findOne({ clientId: client._id, email });
    }
    if (!user && mobile) {
      user = await User.findOne({ clientId: client._id, mobile });
    }
    
    // If user doesn't exist, create one
    if (!user) {
      user = new User({
        email: email || `profile_${Date.now()}@temp.com`,
        mobile: mobile || null,
        password: 'temp_password_' + Date.now(),
        registrationStep: 0,
        emailVerified: false,
        mobileVerified: false,
        clientId: client._id,
        clientCode: client.clientId
      });
    }

    // Update profile information
    if (!user.profile) {
      user.profile = {};
    }
    
    if (name) user.profile.name = name;
    if (dob) user.profile.dob = new Date(dob);
    if (timeOfBirth) user.profile.timeOfBirth = timeOfBirth;
    if (placeOfBirth) user.profile.placeOfBirth = placeOfBirth;
    if (latitude !== undefined) user.profile.latitude = parseFloat(latitude);
    if (longitude !== undefined) user.profile.longitude = parseFloat(longitude);
    if (gowthra) user.profile.gowthra = gowthra;

    // Mark registration as complete
    user.registrationStep = 3;
    user.loginApproved = true;
    user.isActive = true;
    await user.save();

    // Generate JWT token
    const token = generateToken(user._id, 'user', user.clientId);

    res.json({
      success: true,
      message: 'Profile completed successfully. Registration complete!',
      data: {
        user: { ...user.toObject(), role: 'user' },
        token,
        registrationStep: 3,
        registrationComplete: true,
        emailVerified: user.emailVerified || false,
        mobileVerified: user.mobileVerified || false,
        profileCompleted: true,
        clientId: client.clientId,
        clientName: client.businessName
      }
    });
  } catch (error) {
    console.error('Step 3 registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to complete profile' 
    });
  }
});

/**
 * Upload Profile Image (direct upload from form-data)
 * POST /api/mobile/user/profile/image
 * Headers: Authorization: Bearer <token>
 * Content-Type: multipart/form-data
 * Fields: image (file)
 */
router.post('/profile/image', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. User access required.',
      });
    }

    const imageFile = req.file;
    if (!imageFile) {
      return res.status(400).json({
        success: false,
        message: 'Image file is required (field name: image)',
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.registrationStep < 3) {
      return res.status(400).json({
        success: false,
        message: 'Please complete profile first before uploading image',
        data: {
          registrationStep: user.registrationStep,
        },
      });
    }

    // Delete old image if exists
    if (user.profileImage) {
      try {
        await deleteObject(user.profileImage);
      } catch (deleteErr) {
        console.error('Error deleting old profile image:', deleteErr);
      }
    }

    // Generate unique key and upload new image to S3
    const fileExtension = imageFile.originalname.split('.').pop() || 'jpg';
    const imageKey = `images/user/${user._id}/profile/${uuidv4()}.${fileExtension}`;

    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: imageKey,
      Body: imageFile.buffer,
      ContentType: imageFile.mimetype,
    });

    await s3Client.send(uploadCommand);

    // Save S3 key in user profile
    user.profileImage = imageKey;
    await user.save();

    // Return presigned URL for immediate use
    let profileImageUrl = null;
    try {
      profileImageUrl = await getobject(imageKey);
    } catch (urlErr) {
      console.error('Error generating presigned URL:', urlErr);
    }

    res.json({
      success: true,
      message: 'Profile image uploaded successfully',
      data: {
        user: {
          ...user.toObject(),
          role: 'user',
          profileImageUrl,
        },
      },
    });
  } catch (error) {
    console.error('Profile image upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload profile image',
    });
  }
});

/**
 * Check Email and Get Auth Token
 * POST /api/mobile/user/check-email
 * Body: { email, clientId }
 */
router.post('/check-email', async (req, res) => {
  try {
    const { email, clientId: clientCode } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    let user = await User.findOne({ clientId: client._id, email });
    
    if (!user) {
      // Create user and mark email as verified
      user = new User({
        email: email,
        emailVerified: true,
        password: 'temp_password_' + Date.now(),
        registrationStep: 1,
        mobileVerified: false,
        clientId: client._id,
        clientCode: client.clientId
      });
      await user.save();
      
      return res.json({
        success: false,
        message: 'not registered',
        data: {
          registered: false,
          email: email,
          emailVerified: true,
          registrationStep: 1,
          clientId: client.clientId
        }
      });
    }

    if (!user.emailVerified) {
      user.emailVerified = true;
      user.registrationStep = 1;
      await user.save();
    }

    if (user.registrationStep < 3) {
      return res.json({
        success: false,
        message: 'not registered',
        data: {
          registered: false,
          email: email,
          emailVerified: user.emailVerified,
          registrationStep: user.registrationStep,
          nextStep: user.registrationStep === 1 ? 'mobile_verification' : 'profile_completion',
          clientId: client.clientId
        }
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    const token = generateToken(user._id, 'user', user.clientId);

    res.json({
      success: true,
      message: 'User found',
      data: {
        registered: true,
        user: { ...user.toObject(), role: 'user' },
        token,
        emailVerified: user.emailVerified,
        clientId: client.clientId,
        clientName: client.businessName
      }
    });
  } catch (error) {
    console.error('Check email error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to check email' 
    });
  }
});

// ============================================
// LOGIN
// ============================================

/**
 * User Login (Mobile)
 * POST /api/mobile/user/login
 * Body: { email, password, clientId (optional) }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password, clientId: clientCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    // Build query - if clientId provided, filter by it
    let query = { email };
    if (clientCode) {
      const client = await validateClientId(clientCode);
      query.clientId = client._id;
    }

    // Find user by email (and optionally by clientId)
    const user = await User.findOne(query)
      .select('+password')
      .populate('clientId', 'clientId businessName email');
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (user.registrationStep < 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Registration incomplete. Please complete all registration steps.',
        data: {
          registrationStep: user.registrationStep,
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified
        }
      });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    // Generate token with user's clientId (ObjectId)
    const token = generateToken(user._id, 'user', user.clientId._id);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: { 
          ...user.toObject(), 
          role: 'user',
          password: undefined // Remove password from response
        },
        token,
        clientId: user.clientId?.clientId || null,
        clientName: user.clientId?.businessName || null
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Login failed' 
    });
  }
});

// ============================================
// PROFILE MANAGEMENT
// ============================================

/**
 * Get User Profile (Mobile)
 * GET /api/mobile/user/profile
 * Headers: Authorization: Bearer <token>
 */
router.get('/profile', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. User access required.' 
      });
    }

    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('clientId', 'clientId businessName email');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Generate presigned URL for profile image if exists
    let profileImageUrl = null;
    if (user.profileImage) {
      try {
        const { getobject } = await import('../../utils/s3.js');
        profileImageUrl = await getobject(user.profileImage);
      } catch (error) {
        console.error('Error generating profile image URL:', error);
      }
    }

    const userData = user.toObject();
    if (profileImageUrl) {
      userData.profileImageUrl = profileImageUrl;
    }

    const token = generateToken(user._id, 'user', user.clientId);

    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        user: { ...userData, role: 'user' },
        token
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to fetch profile' 
    });
  }
});

/**
 * Update User Profile (Mobile)
 * PUT /api/mobile/user/profile
 * Headers: Authorization: Bearer <token>
 * Body: { name, dob, timeOfBirth, placeOfBirth, latitude, longitude, gowthra, imageFileName, imageContentType }
 */
router.put('/profile', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. User access required.' 
      });
    }

    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Update email if provided
    if (req.body.email) {
      user.email = req.body.email;
    }

    // Update password if provided
    if (req.body.password) {
      user.password = req.body.password;
    }

    // Update mobile if provided
    if (req.body.mobile) {
      user.mobile = req.body.mobile;
    }

    // Update profile fields if provided
    if (req.body.profile || req.body.name || req.body.dob || req.body.timeOfBirth || 
        req.body.placeOfBirth || req.body.latitude !== undefined || req.body.longitude !== undefined ||
        req.body.gowthra) {
      user.profile = {
        ...user.profile,
        ...(req.body.profile || {}),
        ...(req.body.name && { name: req.body.name }),
        ...(req.body.dob && { dob: new Date(req.body.dob) }),
        ...(req.body.timeOfBirth && { timeOfBirth: req.body.timeOfBirth }),
        ...(req.body.placeOfBirth && { placeOfBirth: req.body.placeOfBirth }),
        ...(req.body.latitude !== undefined && { latitude: parseFloat(req.body.latitude) }),
        ...(req.body.longitude !== undefined && { longitude: parseFloat(req.body.longitude) }),
        ...(req.body.gowthra && { gowthra: req.body.gowthra })
      };
    }

    // Handle image upload if provided
    let imageKey = null;
    let presignedUrl = null;

    if (req.body.imageFileName && req.body.imageContentType) {
      const fileExtension = req.body.imageFileName.split('.').pop();
      imageKey = `images/user/${user._id}/profile/${uuidv4()}.${fileExtension}`;
      
      presignedUrl = await putobject(imageKey, req.body.imageContentType);
      
      user.profileImage = imageKey;
    }

    await user.save();

    const token = generateToken(user._id, 'user', user.clientId);

    const response = {
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: { ...user.toObject(), role: 'user' },
        token
      }
    };

    if (presignedUrl) {
      response.data.imageUpload = {
        presignedUrl,
        key: imageKey
      };
    }

    res.json(response);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to update profile' 
    });
  }
});

// ============================================
// RESEND OTP ENDPOINTS
// ============================================

/**
 * Resend Email OTP
 * POST /api/mobile/user/register/resend-email-otp
 * Body: { email, clientId }
 */
router.post('/register/resend-email-otp', async (req, res) => {
  try {
    const { email, clientId: clientCode } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    const user = await User.findOne({ 
      clientId: client._id, 
      email 
    }).select('+emailOtp +emailOtpExpiry');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please start registration again.' 
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email already verified' 
      });
    }

    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    user.emailOtp = otp;
    user.emailOtpExpiry = otpExpiry;
    await user.save();

    const emailResult = await sendEmailOTP(email, otp);
    if (!emailResult.success) {
      console.warn('Email OTP sending had issues, but continuing:', emailResult.message);
    }

    res.json({
      success: true,
      message: 'OTP resent to your email'
    });
  } catch (error) {
    console.error('Resend email OTP error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to resend email OTP' 
    });
  }
});

/**
 * Resend Mobile OTP
 * POST /api/mobile/user/register/resend-mobile-otp
 * Body: { email, otpMethod, clientId }
 */
router.post('/register/resend-mobile-otp', async (req, res) => {
  try {
    const { email, otpMethod, clientId: clientCode } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    if (!otpMethod || !['twilio', 'gupshup', 'whatsapp'].includes(otpMethod)) {
      return res.status(400).json({ 
        success: false, 
        message: 'OTP method is required (twilio, gupshup, or whatsapp)' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    const user = await User.findOne({ 
      clientId: client._id, 
      email 
    }).select('+mobileOtp +mobileOtpExpiry');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please start registration again.' 
      });
    }

    if (!user.mobile) {
      return res.status(400).json({ 
        success: false, 
        message: 'Mobile number not provided. Please complete step 2 first.' 
      });
    }

    if (user.mobileVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Mobile already verified' 
      });
    }

    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    user.mobileOtp = otp;
    user.mobileOtpExpiry = otpExpiry;
    user.mobileOtpMethod = otpMethod;
    await user.save();

    // Send OTP based on method
    let otpResult;
    if (otpMethod === 'whatsapp') {
      otpResult = await sendMobileOTP(user.mobile, otp, 'whatsapp');
    } else if (otpMethod === 'gupshup') {
      otpResult = await sendMobileOTP(user.mobile, otp, 'gupshup');
    } else {
      otpResult = await sendMobileOTP(user.mobile, otp, 'twilio');
    }
    
    if (!otpResult.success) {
      console.warn(`${otpMethod.toUpperCase()} OTP sending had issues, but continuing:`, otpResult.message);
    }

    res.json({
      success: true,
      message: `OTP resent to your mobile number via ${otpMethod.toUpperCase()}`
    });
  } catch (error) {
    console.error('Resend mobile OTP error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to resend mobile OTP' 
    });
  }
});

export default router;