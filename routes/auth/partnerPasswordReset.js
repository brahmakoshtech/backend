import express from 'express';
import crypto from 'crypto';
import Partner from '../../models/Partner.js';
import OTP from '../../models/OTP.js';
import { sendEmailOTP } from '../../utils/otp.js';

const router = express.Router();

/**
 * POST /api/auth/partner/forgot-password
 * Request password reset - sends OTP to partner's email
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find partner by email
    const partner = await Partner.findOne({ email: normalizedEmail });

    // Don't reveal if partner exists or not (security best practice)
    // But still need to send OTP only if partner exists
    if (!partner) {
      return res.json({
        success: true,
        message: 'Account not exist.',
      });
    }

    // Check if partner is active
    if (!partner.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is inactive. Please contact administrator.',
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete all existing email OTPs for this email
    await OTP.deleteMany({
      email: normalizedEmail,
      type: 'email',
    });

    // Generate unique sessionId for this password reset request
    const sessionId = crypto.randomBytes(16).toString('hex');

    // Send OTP via email (and let email service persist the OTP)
    const emailResult = await sendEmailOTP(partner.email, otp, {
      purpose: 'password-reset',
      sessionId,
      expiresAt,
    });

    if (!emailResult?.success) {
      // Keep same behavior as user endpoint: don't fail the whole request
      // if email sending encounters issues (we still respond success).
      console.warn('Partner reset OTP sending had issues, but continuing:', emailResult?.message);
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset OTP has been sent.',
    });
  } catch (error) {
    console.error('Error in partner forgot-password:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.',
    });
  }
});

/**
 * POST /api/auth/partner/verify-reset-otp
 * Verify OTP for password reset
 */
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find valid OTP
    const otpRecord = await OTP.findOne({
      email: normalizedEmail,
      otp: otp,
      type: 'email',
      isUsed: false,
      expiresAt: { $gt: new Date() },
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP',
      });
    }

    // Mark OTP as used
    otpRecord.isUsed = true;
    await otpRecord.save();

    // Generate a temporary token for password reset (valid for 15 minutes)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 15 * 60 * 1000);

    // Store reset token in partner
    const partner = await Partner.findOne({ email: normalizedEmail });
    if (partner) {
      partner.resetPasswordToken = resetToken;
      partner.resetPasswordExpires = resetExpires; // 15 minutes
      await partner.save();
    }

    res.json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        resetToken: resetToken,
      },
    });
  } catch (error) {
    console.error('Error in partner verify-reset-otp:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.',
    });
  }
});

/**
 * POST /api/auth/partner/reset-password
 * Reset password with verified token
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body;

    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, reset token, and new password are required',
      });
    }

    // Validate password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find partner and verify reset token
    const partner = await Partner.findOne({ email: normalizedEmail })
      .select('+resetPasswordToken +resetPasswordExpires');

    if (
      !partner ||
      !partner.resetPasswordToken ||
      partner.resetPasswordToken !== resetToken ||
      !partner.resetPasswordExpires ||
      partner.resetPasswordExpires <= new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    // Update password
    partner.password = newPassword;
    partner.resetPasswordToken = null;
    partner.resetPasswordExpires = null;
    await partner.save();

    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.',
    });
  } catch (error) {
    console.error('Error in partner reset-password:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.',
    });
  }
});

/**
 * POST /api/auth/partner/resend-reset-otp
 * Resend password reset OTP
 */
router.post('/resend-reset-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find partner
    const partner = await Partner.findOne({ email: normalizedEmail });

    if (!partner) {
      // Return success message even if partner doesn't exist (security)
      return res.json({
        success: true,
        message: 'If an account exists with this email, a password reset OTP has been sent.',
      });
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete existing OTPs for this email
    await OTP.deleteMany({
      email: normalizedEmail,
      type: 'email',
    });

    // Generate unique sessionId to avoid duplicate issues
    const sessionId = crypto.randomBytes(16).toString('hex');

    // Create OTP record explicitly
    const otpRecord = new OTP({
      email: normalizedEmail,
      otp: otp,
      type: 'email',
      expiresAt: expiresAt,
      isUsed: false,
      client: 'brahmakosh',
      sessionId: sessionId,
    });
    await otpRecord.save();

    // Send OTP via email
    const emailResult = await sendEmailOTP(partner.email, otp);

    if (!emailResult?.success) {
      console.error('Failed to send partner reset email OTP:', emailResult?.message);
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset OTP has been sent.',
    });
  } catch (error) {
    console.error('Error in partner resend-reset-otp:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.',
    });
  }
});

export default router;

