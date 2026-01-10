import express from 'express';
import crypto from 'crypto';
import User from '../../models/User.js';
import OTP from '../../models/OTP.js';
import { sendEmailOTP } from '../../utils/otp.js';

const router = express.Router();

/**
 * POST /api/auth/user/forgot-password
 * Request password reset - sends OTP to user's email
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    console.log('[forgot-password] request', { email });

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    
    // Don't reveal if user exists or not (security best practice)
    // But we still need to send OTP only if user exists
    if (!user) {
      // Return success message even if user doesn't exist (security)
      return res.json({
        success: true,
        message: 'Account not exist.'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is inactive. Please contact administrator.'
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    console.log('[forgot-password] generated otp', { email: user.email, otp, expiresAt });

    // Delete all existing OTPs for this email (both used and unused, expired or not)
    await OTP.deleteMany({
      email: user.email,
      type: 'email'
    });

    // Generate unique sessionId for this password reset request
    const sessionId = crypto.randomBytes(16).toString('hex');

    // Send OTP via email (and let email service persist the OTP)
    console.log('[forgot-password] sending email otp', { email: user.email, sessionId, expiresAt });
    const emailResult = await sendEmailOTP(user.email, otp, {
      purpose: 'password-reset',
      sessionId,
      expiresAt
    });

    if (!emailResult.success) {
      console.error('Failed to send email OTP:', emailResult.message);
      // Still return success to user (don't reveal email service issues)
    } else {
      console.log('[forgot-password] email sent', { email: user.email, sessionId, messageId: emailResult.messageId });
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset OTP has been sent.'
    });
  } catch (error) {
    console.error('Error in forgot-password:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * POST /api/auth/user/verify-reset-otp
 * Verify OTP for password reset
 */
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    console.log('[verify-reset-otp] request', { email, otp });

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Find valid OTP
    const otpRecord = await OTP.findOne({
      email: email.toLowerCase().trim(),
      otp: otp,
      type: 'email',
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      console.warn('[verify-reset-otp] no matching otp', { email, otp });
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Mark OTP as used
    otpRecord.isUsed = true;
    await otpRecord.save();

    // Generate a temporary token for password reset (valid for 15 minutes)
    // We'll use a simple approach: store reset token in user model or use JWT
    // For simplicity, we'll just verify and allow password reset
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 15 * 60 * 1000);
    console.log('[verify-reset-otp] otp verified, issuing reset token', { email, resetToken, resetExpires });
    
    // Store reset token in user (we'll add this field)
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (user) {
      user.passwordResetToken = resetToken;
      user.passwordResetExpires = resetExpires; // 15 minutes
      await user.save();
    }

    res.json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        resetToken: resetToken
      }
    });
  } catch (error) {
    console.error('Error in verify-reset-otp:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * POST /api/auth/user/reset-password
 * Reset password with verified OTP token
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body;

    console.log('[reset-password] request', { email, resetToken, newPasswordLength: newPassword ? newPassword.length : 0 });

    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, reset token, and new password are required'
      });
    }

    // Validate password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Find user and verify reset token (select hidden fields to debug mismatches)
    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+passwordResetToken +passwordResetExpires');

    if (
      !user ||
      !user.passwordResetToken ||
      user.passwordResetToken !== resetToken ||
      !user.passwordResetExpires ||
      user.passwordResetExpires <= new Date()
    ) {
    console.warn('[reset-password] invalid or expired token', {
      email,
      foundUser: !!user,
      storedToken: user?.passwordResetToken,
      storedExpires: user?.passwordResetExpires,
      now: new Date()
    });
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

  console.log('[reset-password] token valid, updating password', { email });

    // Update password
    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Error in reset-password:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * POST /api/auth/user/resend-reset-otp
 * Resend password reset OTP
 */
router.post('/resend-reset-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    
    if (!user) {
      // Return success message even if user doesn't exist (security)
      return res.json({
        success: true,
        message: 'If an account exists with this email, a password reset OTP has been sent.'
      });
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete all existing OTPs for this email (both used and unused, expired or not)
    // This ensures we don't have duplicate sessionId issues
    await OTP.deleteMany({
      email: user.email,
      type: 'email'
    });

    // Generate unique sessionId for this password reset request
    const sessionId = crypto.randomBytes(16).toString('hex');

    // Create new OTP record with unique sessionId
    const otpRecord = new OTP({
      email: user.email,
      otp: otp,
      type: 'email',
      expiresAt: expiresAt,
      isUsed: false,
      client: 'brahmakosh',
      sessionId: sessionId // Add unique sessionId to avoid duplicate key error
    });
    await otpRecord.save();

    // Send OTP via email
    const emailResult = await sendEmailOTP(user.email, otp);

    if (!emailResult.success) {
      console.error('Failed to send email OTP:', emailResult.message);
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset OTP has been sent.'
    });
  } catch (error) {
    console.error('Error in resend-reset-otp:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.'
    });
  }
});

export default router;

