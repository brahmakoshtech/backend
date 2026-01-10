import express from 'express';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import User from '../../models/User.js';
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

// ============================================
// FIREBASE AUTHENTICATION
// ============================================

/**
 * Sign Up with Firebase
 * POST /api/mobile/user/register/firebase
 * Body: { idToken }
 */
router.post('/register/firebase', async (req, res) => {
  try {
    const { idToken } = req.body;

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

    // Verify Firebase token and get user info
    const firebaseUser = await verifyFirebaseToken(idToken);

    // For Google sign in, email might not be verified in Firebase but is trusted
    // Google accounts are automatically verified
    if (!firebaseUser.email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firebase account must have an email address' 
      });
    }
    
    // For Google provider, consider email as verified
    const isEmailVerified = firebaseUser.emailVerified || firebaseUser.providerId === 'google.com';

    // Check if user already exists
    let user = await User.findOne({ 
      $or: [
        { email: firebaseUser.email },
        { firebaseId: firebaseUser.firebaseId }
      ]
    });

    if (user) {
      // User exists - check if registration is complete
      if (user.registrationStep === 3) {
        return res.status(400).json({ 
          success: false, 
          message: 'User already registered. Please use sign in with Firebase instead.' 
        });
      }

      // Update existing user with Firebase info
      user.firebaseId = firebaseUser.firebaseId;
      user.authMethod = 'firebase';
      user.emailVerified = isEmailVerified;
      
      // Update profile if available
      if (firebaseUser.name && !user.profile?.name) {
        user.profile = user.profile || {};
        user.profile.name = firebaseUser.name;
      }
      
      await user.save();
    } else {
      // Create new user with Firebase info
      user = new User({
        email: firebaseUser.email,
        firebaseId: firebaseUser.firebaseId,
        authMethod: 'firebase',
        emailVerified: isEmailVerified,
        password: 'temp_password_' + Date.now(),
        registrationStep: 0,
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
        authMethod: 'firebase'
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
 * Body: { idToken }
 */
router.post('/login/firebase', async (req, res) => {
  try {
    const { idToken } = req.body;

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

    // Verify Firebase token and get user info
    const firebaseUser = await verifyFirebaseToken(idToken);

    if (!firebaseUser.email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Firebase account must have an email address' 
      });
    }
    
    const isEmailVerified = firebaseUser.emailVerified || firebaseUser.providerId === 'google.com';

    // Find user by email or Firebase ID
    let user = await User.findOne({ 
      $or: [
        { email: firebaseUser.email },
        { firebaseId: firebaseUser.firebaseId }
      ]
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please sign up first.' 
      });
    }

    // Check if registration is complete (profile must be completed)
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

    // Update Firebase ID if not set
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

    const token = generateToken(user._id, 'user');

    res.json({
      success: true,
      message: 'Firebase sign in successful',
      data: {
        user: { ...user.toObject(), role: 'user' },
        token,
        authMethod: 'firebase'
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
 * Body: { email, password }
 */
router.post('/register/step1', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    // Check if user already exists
    let user = await User.findOne({ email }).select('+emailOtp +emailOtpExpiry');
    
    // Only block if user is fully registered (step 3)
    if (user && user.registrationStep === 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'User already registered with this email' 
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    if (user) {
      // Update existing user
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
      // Create new user
      user = new User({
        email,
        password: password || 'temp_password_' + Date.now(),
        emailOtp: otp,
        emailOtpExpiry: otpExpiry,
        registrationStep: 0,
        emailVerified: false
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
        registrationStep: 1
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
 * Body: { email, otp }
 */
router.post('/register/step1/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and OTP are required' 
      });
    }

    const user = await User.findOne({ email }).select('+emailOtp +emailOtpExpiry');
    
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
        profileCompleted: user.registrationStep === 3
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
 * Body: { email, mobile, otpMethod: 'twilio' | 'gupshup' | 'whatsapp' }
 */
router.post('/register/step2', async (req, res) => {
  try {
    const { email, mobile, otpMethod } = req.body;

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

    // Validate mobile format
    const mobileRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
    if (!mobileRegex.test(mobile)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid mobile number format' 
      });
    }

    // Find user by mobile or email
    let user = null;
    if (email) {
      user = await User.findOne({ email }).select('+mobileOtp +mobileOtpExpiry');
    }
    
    if (!user) {
      user = await User.findOne({ mobile }).select('+mobileOtp +mobileOtpExpiry');
    }
    
    if (!user) {
      user = new User({
        email: email || `mobile_${mobile}@temp.com`,
        password: 'temp_password_' + Date.now(),
        registrationStep: 0,
        emailVerified: false,
        mobileVerified: false
      });
    }

    // Check if mobile is already registered to another user
    const existingMobileUser = await User.findOne({ 
      mobile, 
      _id: { $ne: user._id },
      mobileVerified: true 
    });
    
    if (existingMobileUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Mobile number already registered' 
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
      // Default to Twilio
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
        registrationStep: 2
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
 * Body: { email, mobile, otp }
 */
router.post('/register/step2/verify', async (req, res) => {
  try {
    const { email, mobile, otp } = req.body;

    if (!otp || (!email && !mobile)) {
      return res.status(400).json({ 
        success: false, 
        message: 'OTP and either email or mobile number are required' 
      });
    }

    // Find user by email or mobile
    let user = null;
    if (email) {
      user = await User.findOne({ email }).select('+mobileOtp +mobileOtpExpiry');
    }
    if (!user && mobile) {
      user = await User.findOne({ mobile }).select('+mobileOtp +mobileOtpExpiry');
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
        profileCompleted: user.registrationStep === 3
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

    // Find user by email or mobile
    let user = null;
    if (email) {
      user = await User.findOne({ email });
    }
    if (!user && mobile) {
      user = await User.findOne({ mobile });
    }
    
    // If user doesn't exist, create one
    if (!user) {
      user = new User({
        email: email || `profile_${Date.now()}@temp.com`,
        mobile: mobile || null,
        password: 'temp_password_' + Date.now(),
        registrationStep: 0,
        emailVerified: false,
        mobileVerified: false
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
    const token = generateToken(user._id, 'user');

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
        profileCompleted: true
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
 * Body: { email }
 */
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    let user = await User.findOne({ email });
    
    if (!user) {
      // Create user and mark email as verified
      user = new User({
        email: email,
        emailVerified: true,
        password: 'temp_password_' + Date.now(),
        registrationStep: 1,
        mobileVerified: false
      });
      await user.save();
      
      return res.json({
        success: false,
        message: 'not registered',
        data: {
          registered: false,
          email: email,
          emailVerified: true,
          registrationStep: 1
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
          nextStep: user.registrationStep === 1 ? 'mobile_verification' : 'profile_completion'
        }
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    const token = generateToken(user._id, 'user');

    res.json({
      success: true,
      message: 'User found',
      data: {
        registered: true,
        user: { ...user.toObject(), role: 'user' },
        token,
        emailVerified: user.emailVerified
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
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const user = await User.findOne({ email });
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

    const token = generateToken(user._id, 'user');

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: { 
          ...user.toObject(), 
          role: 'user' 
        },
        token
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
      .populate('clientId', 'email businessName');
    
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

    const token = generateToken(user._id, 'user');

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

    const token = generateToken(user._id, 'user');

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
 * Body: { email }
 */
router.post('/register/resend-email-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    const user = await User.findOne({ email }).select('+emailOtp +emailOtpExpiry');
    
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

router.post('/register/resend-mobile-otp', async (req, res) => {
  try {
    const { email, otpMethod } = req.body;

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

    const user = await User.findOne({ email }).select('+mobileOtp +mobileOtpExpiry');
    
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