import express from 'express';
import User from '../../models/User.js';
import { generateToken, authenticate } from '../../middleware/auth.js';
import { 
  generateOTP, 
  getOTPExpiry, 
  validateOTP, 
  sendEmailOTP, 
  sendMobileOTP 
} from '../../utils/otp.js';
import { verifyGoogleToken, isGoogleOAuthEnabled } from '../../utils/googleAuth.js';
import { putobject } from '../../utils/s3.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// ============================================
// GOOGLE AUTHENTICATION
// ============================================

/**
 * Sign Up with Google
 * POST /api/mobile/user/register/google
 * Body: { idToken }
 */
router.post('/register/google', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google ID token is required' 
      });
    }

    if (!isGoogleOAuthEnabled()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google OAuth is not configured' 
      });
    }

    // Verify Google token and get user info
    const googleUser = await verifyGoogleToken(idToken);

    if (!googleUser.email || !googleUser.emailVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google email is not verified' 
      });
    }

    // Check if user already exists
    let user = await User.findOne({ 
      $or: [
        { email: googleUser.email },
        { googleId: googleUser.googleId }
      ]
    });

    if (user) {
      // User exists - check if registration is complete
      if (user.registrationStep === 3) {
        return res.status(400).json({ 
          success: false, 
          message: 'User already registered. Please use sign in with Google instead.' 
        });
      }

      // Update existing user with Google info
      user.googleId = googleUser.googleId;
      user.authMethod = 'google';
      user.emailVerified = true;
      user.registrationStep = 1; // Skip email OTP, go to mobile verification
      
      // Update profile if available
      if (googleUser.name && !user.profile?.name) {
        user.profile = user.profile || {};
        user.profile.name = googleUser.name;
      }
      
      await user.save();
    } else {
      // Create new user with Google info
      user = new User({
        email: googleUser.email,
        googleId: googleUser.googleId,
        authMethod: 'google',
        emailVerified: true,
        password: 'temp_password_' + Date.now(), // Temporary password
        registrationStep: 1, // Skip email OTP, go to mobile verification
        profile: {
          name: googleUser.name || ''
        }
      });
      await user.save();
    }

    res.json({
      success: true,
      message: 'Google sign up successful. Please proceed to mobile verification.',
      data: {
        user: { ...user.toObject(), role: 'user' },
        email: user.email,
        registrationStep: 1,
        nextStep: 'mobile_verification',
        authMethod: 'google'
      }
    });
  } catch (error) {
    console.error('Google sign up error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Google sign up failed' 
    });
  }
});

/**
 * Sign In with Google
 * POST /api/mobile/user/login/google
 * Body: { idToken }
 */
router.post('/login/google', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google ID token is required' 
      });
    }

    if (!isGoogleOAuthEnabled()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google OAuth is not configured' 
      });
    }

    // Verify Google token and get user info
    const googleUser = await verifyGoogleToken(idToken);

    if (!googleUser.email || !googleUser.emailVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google email is not verified' 
      });
    }

    // Find user by email or Google ID
    let user = await User.findOne({ 
      $or: [
        { email: googleUser.email },
        { googleId: googleUser.googleId }
      ]
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please sign up first.' 
      });
    }

    // Check if registration is complete
    if (user.registrationStep < 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Registration incomplete. Please complete all registration steps.',
        data: {
          registrationStep: user.registrationStep,
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified,
          nextStep: user.registrationStep === 1 ? 'mobile_verification' : 'profile_completion'
        }
      });
    }

    // Update Google ID if not set
    if (!user.googleId) {
      user.googleId = googleUser.googleId;
      user.authMethod = 'google';
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
      message: 'Google sign in successful',
      data: {
        user: { ...user.toObject(), role: 'user' },
        token,
        authMethod: 'google'
      }
    });
  } catch (error) {
    console.error('Google sign in error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Google sign in failed' 
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
    
    if (user && user.registrationStep === 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'User already registered with this email' 
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    if (user) {
      // Update existing user (incomplete registration)
      user.emailOtp = otp;
      user.emailOtpExpiry = otpExpiry;
      if (password) {
        user.password = password;
      }
      await user.save();
    } else {
      // Create new user
      user = new User({
        email,
        password: password || 'temp_password_' + Date.now(), // Temporary password if Google sign-in
        emailOtp: otp,
        emailOtpExpiry: otpExpiry,
        registrationStep: 0
      });
      await user.save();
    }

    // Send OTP to email
    await sendEmailOTP(email, otp);

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

    // Mark email as verified and update registration step
    user.emailVerified = true;
    user.registrationStep = 1;
    user.emailOtp = undefined;
    user.emailOtpExpiry = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        email: user.email,
        registrationStep: 1,
        nextStep: 'mobile_verification'
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
 * Body: { email, mobile }
 */
router.post('/register/step2', async (req, res) => {
  try {
    const { email, mobile } = req.body;

    if (!email || !mobile) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and mobile number are required' 
      });
    }

    // Validate mobile format (basic validation)
    const mobileRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
    if (!mobileRegex.test(mobile)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid mobile number format' 
      });
    }

    const user = await User.findOne({ email }).select('+mobileOtp +mobileOtpExpiry');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please complete step 1 first.' 
      });
    }

    if (user.registrationStep < 1 || !user.emailVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please complete email verification first' 
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

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    user.mobile = mobile;
    user.mobileOtp = otp;
    user.mobileOtpExpiry = otpExpiry;
    await user.save();

    // Send OTP to mobile
    await sendMobileOTP(mobile, otp);

    res.json({
      success: true,
      message: 'OTP sent to your mobile number. Please verify to continue.',
      data: {
        email: user.email,
        mobile: user.mobile,
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
 * Body: { email, otp }
 */
router.post('/register/step2/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and OTP are required' 
      });
    }

    const user = await User.findOne({ email }).select('+mobileOtp +mobileOtpExpiry');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please start registration again.' 
      });
    }

    if (user.registrationStep < 1 || !user.emailVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please complete email verification first' 
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

    // Mark mobile as verified and update registration step
    user.mobileVerified = true;
    user.registrationStep = 2;
    user.mobileOtp = undefined;
    user.mobileOtpExpiry = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Mobile verified successfully',
      data: {
        email: user.email,
        mobile: user.mobile,
        registrationStep: 2,
        nextStep: 'profile_completion'
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
 * STEP 3: Complete Profile with Image Upload
 * POST /api/mobile/user/register/step3
 * Body: { 
 *   email, 
 *   name, 
 *   dob, 
 *   timeOfBirth, 
 *   placeOfBirth, 
 *   gowthra,
 *   imageFileName (optional),
 *   imageContentType (optional)
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
      gowthra,
      imageFileName,
      imageContentType
    } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    if (!name || !dob || !timeOfBirth || !placeOfBirth || !gowthra) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, date of birth, time of birth, place of birth, and gowthra are required' 
      });
    }

    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please complete previous steps first.' 
      });
    }

    if (user.registrationStep < 2 || !user.mobileVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please complete mobile verification first' 
      });
    }

    // Update profile information
    user.profile = {
      name,
      dob: new Date(dob),
      timeOfBirth,
      placeOfBirth,
      gowthra,
      ...user.profile // Preserve existing profile fields
    };

    // Handle image upload if provided
    let imageKey = null;
    let presignedUrl = null;

    if (imageFileName && imageContentType) {
      // Generate unique key for the profile image
      const fileExtension = imageFileName.split('.').pop();
      imageKey = `images/user/${user._id}/profile/${uuidv4()}.${fileExtension}`;
      
      // Generate presigned URL for image upload
      presignedUrl = await putobject(imageKey, imageContentType);
      
      // Store the S3 key in user profile
      user.profileImage = imageKey;
    }

    // Mark registration as complete
    user.registrationStep = 3;
    await user.save();

    const response = {
      success: true,
      message: 'Profile completed successfully. Registration complete!',
      data: {
        user: { ...user.toObject(), role: 'user' },
        registrationStep: 3,
        registrationComplete: true
      }
    };

    // Include presigned URL if image upload is requested
    if (presignedUrl) {
      response.data.imageUpload = {
        presignedUrl,
        key: imageKey
      };
    }

    res.json(response);
  } catch (error) {
    console.error('Step 3 registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to complete profile' 
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

    // Check if registration is complete
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
    // Verify it's a user
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

    res.json({
      success: true,
      data: {
        user: { ...userData, role: 'user' }
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
 * Body: { name, dob, timeOfBirth, placeOfBirth, gowthra, imageFileName, imageContentType }
 */
router.put('/profile', authenticate, async (req, res) => {
  try {
    // Verify it's a user
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
        req.body.placeOfBirth || req.body.gowthra) {
      user.profile = {
        ...user.profile,
        ...(req.body.profile || {}),
        ...(req.body.name && { name: req.body.name }),
        ...(req.body.dob && { dob: new Date(req.body.dob) }),
        ...(req.body.timeOfBirth && { timeOfBirth: req.body.timeOfBirth }),
        ...(req.body.placeOfBirth && { placeOfBirth: req.body.placeOfBirth }),
        ...(req.body.gowthra && { gowthra: req.body.gowthra })
      };
    }

    // Handle image upload if provided
    let imageKey = null;
    let presignedUrl = null;

    if (req.body.imageFileName && req.body.imageContentType) {
      // Delete old image if exists (optional - you might want to keep old images)
      // if (user.profileImage) {
      //   try {
      //     const { deleteObject } = await import('../../utils/s3.js');
      //     await deleteObject(user.profileImage);
      //   } catch (error) {
      //     console.error('Error deleting old image:', error);
      //   }
      // }

      // Generate unique key for the profile image
      const fileExtension = req.body.imageFileName.split('.').pop();
      imageKey = `images/user/${user._id}/profile/${uuidv4()}.${fileExtension}`;
      
      // Generate presigned URL for image upload
      presignedUrl = await putobject(imageKey, req.body.imageContentType);
      
      // Store the S3 key in user profile
      user.profileImage = imageKey;
    }

    await user.save();

    const response = {
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: { ...user.toObject(), role: 'user' }
      }
    };

    // Include presigned URL if image upload is requested
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

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    user.emailOtp = otp;
    user.emailOtpExpiry = otpExpiry;
    await user.save();

    // Send OTP to email
    await sendEmailOTP(email, otp);

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
 * Body: { email }
 */
router.post('/register/resend-mobile-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
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

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    user.mobileOtp = otp;
    user.mobileOtpExpiry = otpExpiry;
    await user.save();

    // Send OTP to mobile
    await sendMobileOTP(user.mobile, otp);

    res.json({
      success: true,
      message: 'OTP resent to your mobile number'
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
