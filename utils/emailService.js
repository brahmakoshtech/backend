import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Brevo API configuration
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_ENABLED = process.env.EMAIL_ENABLED === 'true';
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.BREVO_FROM_EMAIL;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || process.env.APP_NAME || 'Brahmakosh';

export const sendEmailOTP = async (email, otp, purpose = 'verification') => {
  const appName = process.env.APP_NAME || 'Brahmakosh';

  // Log OTP to console in development or if email is disabled
  if (!EMAIL_ENABLED || process.env.NODE_ENV === 'development') {
    console.log(`📧 ${purpose === 'password-reset' ? 'Password Reset' : 'Email'} OTP for ${email}: ${otp}`);
  }

  // If email is disabled, just log and return
  if (!EMAIL_ENABLED) {
    return { success: true, message: 'OTP logged to console' };
  }

  // Check if Brevo API key is configured
  if (!BREVO_API_KEY) {
    console.warn('⚠️ Brevo API key not configured. OTPs will be logged to console.');
    return { success: true, message: 'OTP logged to console (Brevo not configured)' };
  }

  if (!EMAIL_FROM) {
    console.warn('⚠️ EMAIL_FROM or BREVO_FROM_EMAIL not configured. OTPs will be logged to console.');
    return { success: true, message: 'OTP logged to console (sender email not configured)' };
  }

  let subject, html;
  
  if (purpose === 'password-reset') {
    subject = `${appName} - Password Reset OTP`;
    html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .otp-box { background-color: #fff; border: 2px solid #4CAF50; padding: 20px; text-align: center; margin: 20px 0; }
          .otp-code { font-size: 32px; font-weight: bold; color: #4CAF50; letter-spacing: 5px; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${appName}</h1>
          </div>
          <div class="content">
            <h2>Password Reset Request</h2>
            <p>You have requested to reset your password. Use the following OTP to verify your identity:</p>
            <div class="otp-box">
              <div class="otp-code">${otp}</div>
            </div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't request this password reset, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  } else {
    subject = `${appName} - Email Verification OTP`;
    html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .otp-box { background-color: #fff; border: 2px solid #4CAF50; padding: 20px; text-align: center; margin: 20px 0; }
          .otp-code { font-size: 32px; font-weight: bold; color: #4CAF50; letter-spacing: 5px; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${appName}</h1>
          </div>
          <div class="content">
            <h2>Email Verification</h2>
            <p>Please use the following OTP to verify your email address:</p>
            <div class="otp-box">
              <div class="otp-code">${otp}</div>
            </div>
            <p>This OTP will expire in 10 minutes.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  try {
    // Send email using Brevo API
    const response = await axios.post(
      BREVO_API_URL,
      {
        sender: {
          name: EMAIL_FROM_NAME,
          email: EMAIL_FROM
        },
        to: [
          {
            email: email
          }
        ],
        subject: subject,
        htmlContent: html
      },
      {
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Email sent successfully via Brevo:', response.data);
    return { success: true, message: 'OTP sent successfully via Brevo' };
  } catch (error) {
    console.error('❌ Error sending email via Brevo:', error.response?.data || error.message);
    return { 
      success: false, 
      message: error.response?.data?.message || error.message || 'Failed to send email'
    };
  }
};

export default { sendEmailOTP };

