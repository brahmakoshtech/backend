import express from 'express';
import User from '../../models/User.js';
import OTP from '../../models/OTP.js';
import {
  generateOTP,
  getOTPExpiry,
  verifyOTPFromDB,
  sendMobileOTP,
} from '../../utils/otp.js';
import { generateToken } from '../../middleware/auth.js';

const router = express.Router();

// Send OTP for Apple sign-up
// POST /api/auth/user/apple/otp/send
// Body: { mobile: "+91XXXXXXXXXX", email: "user@example.com", clientId: "CLI-KBHUMT" }
router.post('/apple/otp/send', async (req, res) => {
  try {
    const { mobile, email, clientId } = req.body;

    if (!mobile || !email || !clientId) {
      return res.status(400).json({
        success: false,
        message: 'mobile, email and clientId are required',
      });
    }

    const otpCode = generateOTP();
    const expiresAt = getOTPExpiry();

    await OTP.updateMany(
      { mobile, type: { $in: ['whatsapp', 'sms', 'mobile'] }, isUsed: false },
      { $set: { isUsed: true } }
    );

    await OTP.create({
      mobile,
      otp: otpCode,
      expiresAt,
      type: 'sms',
      client: 'brahmakosh',
    });

    await sendMobileOTP(
      mobile,
      otpCode,
      process.env.DEFAULT_OTP_METHOD || 'gupshup'
    );

    return res.status(200).json({
      success: true,
      message: 'OTP sent to mobile',
    });
  } catch (error) {
    console.error('Apple OTP send error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP: ' + error.message,
    });
  }
});

// Verify OTP and complete Apple sign-up
// POST /api/auth/user/apple/otp/verify
// Body: { mobile, otp, email, clientId }
router.post('/apple/otp/verify', async (req, res) => {
  try {
    const { mobile, otp, email, clientId } = req.body;

    if (!mobile || !otp || !email || !clientId) {
      return res.status(400).json({
        success: false,
        message: 'mobile, otp, email and clientId are required',
      });
    }

    const result = await verifyOTPFromDB(mobile, otp, 'mobile');
    if (!result.valid) {
      return res.status(422).json({
        success: false,
        message: result.message || 'Invalid OTP',
      });
    }

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        email,
        password: 'apple_auth_' + Date.now(),
        authMethod: 'firebase',
        mobile,
        mobileVerified: true,
        emailVerified: true,
        loginApproved: true,
        isActive: true,
        registrationStep: 3,
      });
      await user.save();
    } else {
      user.mobile = user.mobile || mobile;
      user.mobileVerified = true;
      user.emailVerified = true;
      user.authMethod = 'firebase';
      user.loginApproved = true;
      user.registrationStep = Math.max(user.registrationStep || 0, 3);
      await user.save();
    }

    if (user.clientId) {
      await user.populate('clientId', 'clientId businessName email');
    }

    const token = generateToken(
      user._id,
      'user',
      user.clientId?._id || user.clientId
    );

    return res.status(200).json({
      success: true,
      message: 'Apple sign-up completed',
      data: {
        token,
        user: { ...user.toJSON(), role: 'user' },
        clientId: user.clientId?.clientId || null,
        clientName: user.clientId?.businessName || null,
      },
    });
  } catch (error) {
    console.error('Apple OTP verify error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP: ' + error.message,
    });
  }
});

export default router;

