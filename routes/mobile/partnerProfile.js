import express from 'express';
import multer from 'multer';
import { PutObjectCommand 
      } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import Partner from '../../models/Partner.js';
import Client from '../../models/Client.js';
import { generateToken, authenticate } from '../../middleware/auth.js';
import {
  generateOTP,
  getOTPExpiry,
  validateOTP,
  sendEmailOTP,
  sendMobileOTP,
} from '../../utils/otp.js';
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

// ============================================
// REGISTRATION FLOW - MULTI-STEP
// ============================================

/**
 * STEP 1: Email OTP Verification
 * POST /api/mobile/partner/register/step1
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

    // Check if partner already exists for this client
    let partner = await Partner.findOne({ 
      clientId: client._id,
      email 
    }).select('+emailOtp +emailOtpExpiry');
    
    if (partner && partner.registrationStep === 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Partner already registered with this email for this client' 
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    if (partner) {
      partner.emailOtp = otp;
      partner.emailOtpExpiry = otpExpiry;
      if (password) {
        partner.password = password;
      }
      if (!partner.emailVerified) {
        partner.emailVerified = false;
      }
      await partner.save();
    } else {
      partner = new Partner({
        email,
        password: password || 'temp_password_' + Date.now(),
        emailOtp: otp,
        emailOtpExpiry: otpExpiry,
        registrationStep: 0,
        emailVerified: false,
        clientId: client._id,
        clientCode: client.clientId
      });
      await partner.save();
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
        email: partner.email,
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
 * POST /api/mobile/partner/register/step1/verify
 * Body: { email, otp, clientId }
 */
router.post('/register/step1/verify', async (req, res) => {
  try {
    const { email, otp, clientId: clientCode } = req.body;
    console.log(req.body);

    if (!email || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and OTP are required' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    const partner = await Partner.findOne({ 
      clientId: client._id,
      email 
    }).select('+emailOtp +emailOtpExpiry');
    
    if (!partner) {
      return res.status(404).json({ 
        success: false, 
        message: 'Partner not found. Please start registration again.' 
      });
    }

    // Validate OTP
    const validation = validateOTP(partner.emailOtp, otp, partner.emailOtpExpiry);
    if (!validation.valid) {
      return res.status(400).json({ 
        success: false, 
        message: validation.message 
      });
    }

    // Mark email as verified
    partner.emailVerified = true;
    partner.emailOtp = undefined;
    partner.emailOtpExpiry = undefined;
    await partner.save();

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        email: partner.email,
        emailVerified: true,
        phoneVerified: partner.phoneVerified || false,
        profileCompleted: partner.registrationStep === 3,
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
 * STEP 2: Phone OTP Verification
 * POST /api/mobile/partner/register/step2
 * Body: { email, phone, otpMethod: 'twilio' | 'gupshup' | 'whatsapp', clientId }
 */
router.post('/register/step2', async (req, res) => {
  try {
    const { email, phone, otpMethod, clientId: clientCode } = req.body;

    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
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

    // Validate phone format
    const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid phone number format' 
      });
    }

    // Find partner by email for this client
    let partner = null;
    if (email) {
      partner = await Partner.findOne({ 
        clientId: client._id,
        email 
      }).select('+phoneOtp +phoneOtpExpiry');
    }
    
    if (!partner) {
      partner = await Partner.findOne({ 
        clientId: client._id,
        phone 
      }).select('+phoneOtp +phoneOtpExpiry');
    }
    
    if (!partner) {
      partner = new Partner({
        email: email || `phone_${phone}@temp.com`,
        password: 'temp_password_' + Date.now(),
        registrationStep: 0,
        emailVerified: false,
        phoneVerified: false,
        clientId: client._id,
        clientCode: client.clientId
      });
    }

    // Check if phone is already registered to another partner in this client
    const existingPhonePartner = await Partner.findOne({ 
      clientId: client._id,
      phone, 
      _id: { $ne: partner._id },
      phoneVerified: true 
    });
    
    if (existingPhonePartner) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number already registered for this client' 
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    partner.phone = phone;
    partner.phoneOtp = otp;
    partner.phoneOtpExpiry = otpExpiry;
    partner.phoneOtpMethod = otpMethod;
    if (!partner.phoneVerified) {
      partner.phoneVerified = false;
    }
    await partner.save();

    // Send OTP based on method
    let otpResult;
    if (otpMethod === 'whatsapp') {
      otpResult = await sendMobileOTP(phone, otp, 'whatsapp');
    } else if (otpMethod === 'gupshup') {
      otpResult = await sendMobileOTP(phone, otp, 'gupshup');
    } else {
      otpResult = await sendMobileOTP(phone, otp, 'twilio');
    }
    
    if (!otpResult.success) {
      console.warn(`${otpMethod.toUpperCase()} OTP sending had issues, but continuing:`, otpResult.message);
    }

    res.json({
      success: true,
      message: `OTP sent to your phone via ${otpMethod.toUpperCase()}. Please verify to continue.`,
      data: {
        email: partner.email,
        phone: partner.phone,
        otpMethod,
        registrationStep: 2,
        clientId: client.clientId
      }
    });
  } catch (error) {
    console.error('Step 2 registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to send phone OTP' 
    });
  }
});

/**
 * STEP 2 VERIFY: Verify Phone OTP
 * POST /api/mobile/partner/register/step2/verify
 * Body: { email, phone, otp }
 */
router.post('/register/step2/verify', async (req, res) => {
  try {
    const { email, phone, otp, clientId: clientCode } = req.body;

    if (!otp || (!email && !phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'OTP and either email or phone number are required' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    // Find partner by email or phone for this client
    let partner = null;
    if (email) {
      partner = await Partner.findOne({ 
        clientId: client._id,
        email 
      }).select('+phoneOtp +phoneOtpExpiry');
    }
    if (!partner && phone) {
      partner = await Partner.findOne({ 
        clientId: client._id,
        phone 
      }).select('+phoneOtp +phoneOtpExpiry');
    }
    
    if (!partner) {
      return res.status(404).json({ 
        success: false, 
        message: 'Partner not found. Please send phone OTP first (step 2).' 
      });
    }
    
    if (!partner.phoneOtp) {
      return res.status(400).json({ 
        success: false, 
        message: 'No OTP found. Please send phone OTP first (step 2).' 
      });
    }

    // Validate OTP
    const validation = validateOTP(partner.phoneOtp, otp, partner.phoneOtpExpiry);
    if (!validation.valid) {
      return res.status(400).json({ 
        success: false, 
        message: validation.message 
      });
    }

    // Mark phone as verified
    partner.phoneVerified = true;
    partner.phoneOtp = undefined;
    partner.phoneOtpExpiry = undefined;
    partner.phoneOtpMethod = undefined;
    await partner.save();

    res.json({
      success: true,
      message: 'Phone verified successfully',
      data: {
        email: partner.email,
        phone: partner.phone,
        phoneVerified: true,
        emailVerified: partner.emailVerified || false,
        profileCompleted: partner.registrationStep === 3
      }
    });
  } catch (error) {
    console.error('Phone OTP verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to verify phone OTP' 
    });
  }
});

/**
 * STEP 3: Complete Profile
 * POST /api/mobile/partner/register/step3
 * Body: { 
 *   email (required),
 *   name (required),
 *   experienceRange (optional) - '0-2', '3-5', '6-10', '10+',
 *   expertiseCategory (optional) - 'Astrology', 'Vastu', 'Reiki', 'Healer', 'Numerology', 'Others',
 *   skills (optional) - Array of strings (max 5),
 *   consultationModes (optional) - Array ['Call', 'Chat', 'Video'],
 *   languages (optional) - Array of strings,
 *   bio (optional) - String (max 300 chars),
 *   availabilityPreference (optional) - Array ['Weekdays', 'Weekends', 'Flexible'],
 *   location (optional) - { city, country, coordinates: { latitude, longitude } }
 * }
 */
router.post('/register/step3', async (req, res) => {
  try {
    const { 
      email, 
      clientId: clientCode,
      name,
      experienceRange,
      expertiseCategory,
      skills,
      consultationModes,
      languages,
      bio,
      availabilityPreference,
      location
    } = req.body;

    const { phone } = req.body;
    
    if (!email && !phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email or phone number is required' 
      });
    }

    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name is required' 
      });
    }

    // Validate client
    const client = await validateClientId(clientCode);

    // Find partner by email or phone for this client
    let partner = null;
    if (email) {
      partner = await Partner.findOne({ 
        clientId: client._id,
        email 
      });
    }
    if (!partner && phone) {
      partner = await Partner.findOne({ 
        clientId: client._id,
        phone 
      });
    }
    
    // If partner doesn't exist, create one
    if (!partner) {
      partner = new Partner({
        email: email || `profile_${Date.now()}@temp.com`,
        phone: phone || null,
        password: 'temp_password_' + Date.now(),
        registrationStep: 0,
        emailVerified: false,
        phoneVerified: false,
        clientId: client._id,
        clientCode: client.clientId
      });
    }

    // Update profile information
    partner.name = name;
    
    // Update optional fields
    if (experienceRange) {
      partner.experienceRange = experienceRange;
      // Also set numeric experience for backward compatibility
      const expMap = { '0-2': 1, '3-5': 4, '6-10': 8, '10+': 15 };
      partner.experience = expMap[experienceRange] || 0;
    }
    
    if (expertiseCategory) partner.expertiseCategory = expertiseCategory;
    
    if (skills && Array.isArray(skills)) {
      if (skills.length > 5) {
        return res.status(400).json({ 
          success: false, 
          message: 'Maximum 5 skills allowed' 
        });
      }
      partner.skills = skills;
    }
    
    if (consultationModes && Array.isArray(consultationModes)) {
      partner.consultationModes = consultationModes;
    }
    
    if (languages && Array.isArray(languages)) {
      partner.languages = languages;
    }
    
    if (bio) {
      if (bio.length > 300) {
        return res.status(400).json({ 
          success: false, 
          message: 'Bio must be 300 characters or less (approximately 50 words)' 
        });
      }
      partner.bio = bio;
    }
    
    if (availabilityPreference && Array.isArray(availabilityPreference)) {
      partner.availabilityPreference = availabilityPreference;
    }
    
    if (location) {
      if (location.city) partner.location.city = location.city;
      if (location.country) partner.location.country = location.country;
      if (location.coordinates) {
        if (location.coordinates.latitude !== undefined) {
          const lat = parseFloat(location.coordinates.latitude);
          if (lat >= -90 && lat <= 90) {
            partner.location.coordinates.latitude = lat;
          }
        }
        if (location.coordinates.longitude !== undefined) {
          const lng = parseFloat(location.coordinates.longitude);
          if (lng >= -180 && lng <= 180) {
            partner.location.coordinates.longitude = lng;
          }
        }
      }
    }

    // Mark registration as complete
    partner.registrationStep = 3;
    partner.isActive = true;
    partner.isVerified = false; // Admin needs to verify
    await partner.save();

    // Generate JWT token
    const token = generateToken(partner._id, 'partner');

    res.json({
      success: true,
      message: 'Profile completed successfully. Registration complete! Awaiting admin verification.',
      data: {
        partner: { ...partner.toObject(), role: 'partner' },
        token,
        registrationStep: 3,
        registrationComplete: true,
        emailVerified: partner.emailVerified || false,
        phoneVerified: partner.phoneVerified || false,
        profileCompleted: true,
        isVerified: partner.isVerified,
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
 * STEP 4: Upload Profile Picture (Registration Flow)
 * POST /api/mobile/partner/register/step4
 * Headers: Authorization: Bearer <token>
 * Content-Type: multipart/form-data
 * Fields: image (file)
 */
router.post('/register/step4', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Partner access required.',
      });
    }

    const imageFile = req.file;
    if (!imageFile) {
      return res.status(400).json({
        success: false,
        message: 'Image file is required (field name: image)',
      });
    }

    const partner = await Partner.findById(req.user._id).populate('clientId', 'clientId businessName');
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner not found',
      });
    }

    if (partner.registrationStep < 3) {
      return res.status(400).json({
        success: false,
        message: 'Please complete Step 3 (profile completion) first',
        data: {
          registrationStep: partner.registrationStep,
        },
      });
    }

    // Delete old picture if exists and not a Google profile picture
    if (partner.profilePicture && !partner.profilePicture.startsWith('http')) {
      try {
        await deleteObject(partner.profilePicture);
      } catch (deleteErr) {
        console.error('Error deleting old profile picture:', deleteErr);
      }
    }

    // Generate unique key and upload new image to S3
    const fileExtension = imageFile.originalname.split('.').pop() || 'jpg';
    const imageKey = `images/partner/${partner._id}/profile/${uuidv4()}.${fileExtension}`;

    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: imageKey,
      Body: imageFile.buffer,
      ContentType: imageFile.mimetype,
    });

    await s3Client.send(uploadCommand);

    // Save S3 key in partner profile (key + key field for consistency with experts/crud)
    partner.profilePicture = imageKey;
    partner.profilePictureKey = imageKey;
    partner.registrationStep = 4; // Mark Step 4 as complete
    await partner.save();

    // Return presigned URL for immediate use
    let profilePictureUrl = null;
    try {
      profilePictureUrl = await getobject(imageKey);
    } catch (urlErr) {
      console.error('Error generating presigned URL:', urlErr);
    }

    // Generate new token with updated info
    const token = generateToken(partner._id, 'partner', partner.clientId._id);

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully. Registration complete!',
      data: {
        partner: {
          ...partner.toObject(),
          role: 'partner',
          profilePictureUrl,
        },
        token,
        registrationStep: 4,
        registrationComplete: true,
        clientId: partner.clientId?.clientId || null,
        clientName: partner.clientId?.businessName || null
      },
    });
  } catch (error) {
    console.error('Profile picture upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload profile picture',
    });
  }
});

/**
 * Upload/Update Profile Picture (For existing partners)
 * POST /api/mobile/partner/profile/picture
 * Headers: Authorization: Bearer <token>
 * Content-Type: multipart/form-data
 * Fields: image (file)
 */
router.post('/profile/picture', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Partner access required.',
      });
    }

    const imageFile = req.file;
    if (!imageFile) {
      return res.status(400).json({
        success: false,
        message: 'Image file is required (field name: image)',
      });
    }

    const partner = await Partner.findById(req.user._id).populate('clientId', 'clientId businessName');
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner not found',
      });
    }

    // Delete old picture if exists and not a Google profile picture
    if (partner.profilePicture && !partner.profilePicture.startsWith('http')) {
      try {
        await deleteObject(partner.profilePicture);
      } catch (deleteErr) {
        console.error('Error deleting old profile picture:', deleteErr);
      }
    }

    // Generate unique key and upload new image to S3
    const fileExtension = imageFile.originalname.split('.').pop() || 'jpg';
    const imageKey = `images/partner/${partner._id}/profile/${uuidv4()}.${fileExtension}`;

    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: imageKey,
      Body: imageFile.buffer,
      ContentType: imageFile.mimetype,
    });

    await s3Client.send(uploadCommand);

    // Save S3 key in partner profile (key + key field for consistency with experts/crud)
    partner.profilePicture = imageKey;
    partner.profilePictureKey = imageKey;
    await partner.save();

    // Return presigned URL for immediate use
    let profilePictureUrl = null;
    try {
      profilePictureUrl = await getobject(imageKey);
    } catch (urlErr) {
      console.error('Error generating presigned URL:', urlErr);
    }

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      data: {
        partner: {
          ...partner.toObject(),
          role: 'partner',
          profilePictureUrl,
        },
      },
    });
  } catch (error) {
    console.error('Profile picture upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload profile picture',
    });
  }
});

/**
 * Check Email and Get Auth Token
 * POST /api/mobile/partner/check-email
 * Body: { email }
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

    let partner = await Partner.findOne({ clientCode: clientCode, email });
    const client = await validateClientId(clientCode);
    if (!partner) {
      // Create partner and mark email as verified
      partner = new Partner({
        email: email,
        emailVerified: true,
        password: 'temp_password_' + Date.now(),
        registrationStep: 1,
        phoneVerified: false,
        clientId: client._id,
        clientCode: client.clientId
      });
      await partner.save();
      
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

    if (!partner.emailVerified) {
      partner.emailVerified = true;
      partner.registrationStep = 1;
      await partner.save();
    }

    if (partner.registrationStep < 3) {
      return res.json({
        success: false,
        message: 'not registered',
        data: {
          registered: false,
          email: email,
          emailVerified: partner.emailVerified,
          registrationStep: partner.registrationStep,
          nextStep: partner.registrationStep === 1 ? 'phone_verification' : 'profile_completion',
          clientId: client.clientId
        }
      });
    }

    if (!partner.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    const token = generateToken(partner._id, 'partner');

    res.json({
      success: true,
      message: 'Partner found',
      data: {
        registered: true,
        partner: { ...partner.toObject(), role: 'partner' },
        token,
        emailVerified: partner.emailVerified,
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
 * Partner Login (Mobile)
 * POST /api/mobile/partner/login
 * Body: { email, password }
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

    // Find partner by email (and optionally by clientId)
    const partner = await Partner.findOne(query).select('+password');
    
    if (!partner) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (partner.registrationStep < 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Registration incomplete. Please complete all registration steps.',
        data: {
          registrationStep: partner.registrationStep,
          emailVerified: partner.emailVerified,
          phoneVerified: partner.phoneVerified
        }
      });
    }

    const isPasswordValid = await partner.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (!partner.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    // Generate token
    const token = generateToken(partner._id, 'partner');

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        partner: { 
          ...partner.toObject(), 
          role: 'partner',
          password: undefined // Remove password from response
        },
        token,
        clientId: partner.clientId?.clientId || null,
        clientName: partner.clientId?.businessName || null
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
 * Get Partner Profile (Mobile)
 * GET /api/mobile/partner/profile
 * Headers: Authorization: Bearer <token>
 */
router.get('/profile', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Partner access required.' 
      });
    }

    const partner = await Partner.findById(req.user._id).select('-password');
    
    if (!partner) {
      return res.status(404).json({ 
        success: false, 
        message: 'Partner not found' 
      });
    }

    // Generate presigned URL for profile picture if exists and is S3 key
    let profilePictureUrl = null;
    if (partner.profilePicture && !partner.profilePicture.startsWith('http')) {
      try {
        const { getobject } = await import('../../utils/s3.js');
        profilePictureUrl = await getobject(partner.profilePicture);
      } catch (error) {
        console.error('Error generating profile picture URL:', error);
      }
    } else if (partner.profilePicture) {
      profilePictureUrl = partner.profilePicture; // Google picture URL
    }

    const partnerData = partner.toObject();
    if (profilePictureUrl) {
      partnerData.profilePictureUrl = profilePictureUrl;
    }

    const token = generateToken(partner._id, 'partner');

    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        partner: { ...partnerData, role: 'partner' },
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
 * Update Partner Profile (Mobile)
 * PUT /api/mobile/partner/profile
 * Headers: Authorization: Bearer <token>
 * Body: { 
 *   name, phone, email, password,
 *   experienceRange, expertiseCategory, skills, consultationModes,
 *   languages, bio, availabilityPreference, location
 * }
 */
router.put('/profile', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'partner') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Partner access required.' 
      });
    }

    const partner = await Partner.findById(req.user._id);
    
    if (!partner) {
      return res.status(404).json({ 
        success: false, 
        message: 'Partner not found' 
      });
    }

    // Update basic fields
    if (req.body.name) partner.name = req.body.name;
    if (req.body.phone) partner.phone = req.body.phone;
    if (req.body.email) partner.email = req.body.email;
    if (req.body.password) partner.password = req.body.password;
    
    // Update professional fields
    if (req.body.experienceRange) {
      partner.experienceRange = req.body.experienceRange;
      const expMap = { '0-2': 1, '3-5': 4, '6-10': 8, '10+': 15 };
      partner.experience = expMap[req.body.experienceRange] || 0;
    }
    
    if (req.body.expertiseCategory) partner.expertiseCategory = req.body.expertiseCategory;
    
    if (req.body.skills && Array.isArray(req.body.skills)) {
      if (req.body.skills.length > 5) {
        return res.status(400).json({ 
          success: false, 
          message: 'Maximum 5 skills allowed' 
        });
      }
      partner.skills = req.body.skills;
    }
    
    if (req.body.consultationModes && Array.isArray(req.body.consultationModes)) {
      partner.consultationModes = req.body.consultationModes;
    }
    
    if (req.body.languages && Array.isArray(req.body.languages)) {
      partner.languages = req.body.languages;
    }
    
    if (req.body.bio !== undefined) {
      if (req.body.bio.length > 300) {
        return res.status(400).json({ 
          success: false, 
          message: 'Bio must be 300 characters or less' 
        });
      }
      partner.bio = req.body.bio;
    }
    
    if (req.body.availabilityPreference && Array.isArray(req.body.availabilityPreference)) {
      partner.availabilityPreference = req.body.availabilityPreference;
    }
    
    // Update location
    if (req.body.location) {
      if (req.body.location.city !== undefined) partner.location.city = req.body.location.city;
      if (req.body.location.country !== undefined) partner.location.country = req.body.location.country;
      if (req.body.location.coordinates) {
        if (req.body.location.coordinates.latitude !== undefined) {
          const lat = parseFloat(req.body.location.coordinates.latitude);
          if (lat >= -90 && lat <= 90) {
            partner.location.coordinates.latitude = lat;
          }
        }
        if (req.body.location.coordinates.longitude !== undefined) {
          const lng = parseFloat(req.body.location.coordinates.longitude);
          if (lng >= -180 && lng <= 180) {
            partner.location.coordinates.longitude = lng;
          }
        }
      }
    }

    await partner.save();

    const token = generateToken(partner._id, 'partner');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        partner: { ...partner.toObject(), role: 'partner' },
        token
      }
    });
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
 * POST /api/mobile/partner/register/resend-email-otp
 * Body: { email }
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

    const partner = await Partner.findOne({ 
      clientId: client._id,
      email 
    }).select('+emailOtp +emailOtpExpiry');
    
    if (!partner) {
      return res.status(404).json({ 
        success: false, 
        message: 'Partner not found. Please start registration again.' 
      });
    }

    if (partner.emailVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email already verified' 
      });
    }

    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    partner.emailOtp = otp;
    partner.emailOtpExpiry = otpExpiry;
    await partner.save();

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
 * Resend Phone OTP
 * POST /api/mobile/partner/register/resend-phone-otp
 * Body: { email, otpMethod }
 */
router.post('/register/resend-phone-otp', async (req, res) => {
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

    const partner = await Partner.findOne({ email }).select('+phoneOtp +phoneOtpExpiry');
    
    if (!partner) {
      return res.status(404).json({ 
        success: false, 
        message: 'Partner not found. Please start registration again.' 
      });
    }

    if (!partner.phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number not provided. Please complete step 2 first.' 
      });
    }

    if (partner.phoneVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone already verified' 
      });
    }

    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    partner.phoneOtp = otp;
    partner.phoneOtpExpiry = otpExpiry;
    partner.phoneOtpMethod = otpMethod;
    await partner.save();

    // Send OTP based on method
    let otpResult;
    if (otpMethod === 'whatsapp') {
      otpResult = await sendMobileOTP(partner.phone, otp, 'whatsapp');
    } else if (otpMethod === 'gupshup') {
      otpResult = await sendMobileOTP(partner.phone, otp, 'gupshup');
    } else {
      otpResult = await sendMobileOTP(partner.phone, otp, 'twilio');
    }
    
    if (!otpResult.success) {
      console.warn(`${otpMethod.toUpperCase()} OTP sending had issues, but continuing:`, otpResult.message);
    }

    res.json({
      success: true,
      message: `OTP resent to your phone number via ${otpMethod.toUpperCase()}`
    });
  } catch (error) {
    console.error('Resend phone OTP error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to resend phone OTP' 
    });
  }
});

export default router;